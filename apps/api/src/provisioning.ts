import { createHmac } from "node:crypto";
import { childLogger, createSponsoredAccount, events, generateKeypair, keypairFromSeed, loadEnv, maxUsdc, sponsorPublicKey, stellarContractUrl, stellarTxUrl } from "@pera/core";
import { createPasskey, createStellarWallet, createUser, getAgentRules, getPasskey, getStellarWallet, getUser, updateStellarWallet, upsertAgentRules, type User } from "@pera/db";
import { ensureUserEvmWallet } from "@pera/evm";
import { verifyRegistration, type RegistrationJSON } from "@pera/passkey";
import { addAgentRule, addSweepRule, attachKit, createKit, deployPasskeySmartAccount, expectedPasskeyContractId, findAgentRuleId, findSweepRuleId, removeInstallerSigner, resetKit } from "@pera/smart-account";

const log = childLogger("api.provisioning");

export interface RegisterInput {
  displayName: string;
  email?: string;
  challenge: string;
  registration: RegistrationJSON;
  dailyCapUsdc?: string;
}

export interface RegisterResult {
  user: User;
  smartAccountId: string;
  deployTxHash?: string;
  agentRuleId: number;
  agentRuleTxHash?: string;
  treasuryPublicKey: string;
  agentPublicKey: string;
  evm: { provider: string; address: string };
  dailyCapUsdc: string;
}

/**
 * One passkey ceremony for the whole sign-up:
 *  1. verify the WebAuthn registration (challenge/origin) and take the P-256 key;
 *  2. deploy the smart account (sponsor pays) with rule 0 = [passkey, temporary installer] + threshold(1);
 *  3. the installer adds the agent rule (agent signer + spending_limit cap) and the treasury-sweep rule (server
 *     key, USDC only: idle smart-account USDC flows to the treasury/vault), then removes itself
 *     → the passkey is the sole owner, the agent is already authorised, no second prompt;
 *  4. treasury + agent accounts with sponsored reserves (0 XLM) and an EVM wallet; session.
 * Resumable: a passkey whose provisioning failed continues where it stopped.
 */
export async function registerUser(input: RegisterInput, allowedOrigins: string[]): Promise<RegisterResult> {
  const env = loadEnv();
  const reg = verifyRegistration({ registration: input.registration, expectedChallenge: input.challenge, expectedOrigins: allowedOrigins });
  const publicKey = Buffer.from(reg.publicKey);
  const credentialId = reg.credentialId;

  const existingPasskey = await getPasskey(credentialId);
  if (existingPasskey) {
    if (await getStellarWallet(existingPasskey.userId)) throw Object.assign(new Error("this passkey is already registered"), { statusCode: 409, code: "ALREADY_REGISTERED" });
    if (!Buffer.from(existingPasskey.publicKey).equals(publicKey)) throw Object.assign(new Error("credential id already used with a different key"), { statusCode: 409, code: "ALREADY_REGISTERED" });
  }
  let user: User;
  if (existingPasskey) user = (await getUser(existingPasskey.userId))!;
  else {
    user = await createUser({ displayName: input.displayName, email: input.email });
    await createPasskey({ credentialId, userId: user.id, publicKey, transports: reg.transports?.join(",") });
    events.emit({ type: "user.registered", userId: user.id, detail: { displayName: user.displayName } });
  }

  // 2. Deploy with a temporary installer co-signer. The installer is derived from the master key and the
  //    credential (never stored) so an interrupted sign-up can resume with the same key.
  const installer = deriveInstaller(credentialId, env.WALLET_MASTER_KEY);
  const contractId = expectedPasskeyContractId(credentialId, sponsorPublicKey(env));
  let deployTxHash: string | undefined;
  if (!(await isDeployed(contractId))) {
    const r = await deployPasskeySmartAccount({ publicKey, credentialId, sponsorSecret: env.SPONSOR_SECRET, installerPublicKey: installer.publicKey });
    if (r.contractId !== contractId) throw new Error(`deployed contract id ${r.contractId} differs from the expected ${contractId}`);
    deployTxHash = r.txHash;
    log.info({ userId: user.id, contractId, hash: r.txHash }, "passkey smart account deployed (sponsored)");
  }
  await assertPasskeyOwns(contractId, publicKey, credentialId);

  // 3. Persist the custodial keys first (status provisioning) so a retry reuses them.
  const dailyCapUsdc = input.dailyCapUsdc ?? env.AGENT_DAILY_CAP_USDC;
  let wallet = await getStellarWallet(user.id);
  if (!wallet) {
    const treasury = generateKeypair();
    const agent = generateKeypair();
    wallet = await createStellarWallet({ userId: user.id, smartAccountId: contractId, credentialId, treasuryPublicKey: treasury.publicKey, treasurySecret: treasury.secret, agentPublicKey: agent.publicKey, agentSecret: agent.secret, dailyCapUsdc });
    if (deployTxHash) await updateStellarWallet(user.id, { deployTxHash });
  }

  try {
    // 4. Agent rule via the installer, then drop the installer (both idempotent on resume).
    const installerCtx = { smartAccountId: contractId, agentSecret: wallet.agentSecret, ownerSecret: installer.secret };
    let ruleId = wallet.agentRuleId;
    let ruleTx: string | undefined;
    if (ruleId === null) {
      const found = await findAgentRuleId(installerCtx);
      if (found !== null) ruleId = found;
      else {
        // both windows go on the rule at creation: daily and weekly are separate spending_limit instances
        const weeklyCapUsdc = maxUsdc(env.AGENT_WEEKLY_CAP_USDC, wallet.dailyCapUsdc);
        const rule = await addAgentRule(installerCtx, { agentPublicKey: wallet.agentPublicKey, capUsdc: wallet.dailyCapUsdc, weeklyCapUsdc });
        ruleId = rule.ruleId;
        ruleTx = rule.txHash;
        await upsertAgentRules(user.id, { ...(await getAgentRules(user.id)), weeklyCapUsdc });
      }
      await updateStellarWallet(user.id, { agentRuleId: ruleId });
    }
    let sweepRuleId = wallet.sweepRuleId;
    if (sweepRuleId === null) {
      sweepRuleId = await findSweepRuleId(installerCtx);
      if (sweepRuleId === null) sweepRuleId = (await addSweepRule(installerCtx, deriveSweeper(credentialId, env.WALLET_MASTER_KEY).publicKey)).ruleId;
      await updateStellarWallet(user.id, { sweepRuleId });
    }
    let removalTx: string | undefined;
    if (await hasSigner(contractId, installer.publicKey)) {
      removalTx = (await removeInstallerSigner(installerCtx, installer.publicKey)).txHash;
    }
    resetKit(contractId); // forget the installer key
    events.emit({ type: "agent.authorized", userId: user.id, network: "stellar:testnet", txHash: ruleTx, explorerUrl: ruleTx ? stellarTxUrl(ruleTx) : stellarContractUrl(contractId), detail: { ruleId, dailyCapUsdc: wallet.dailyCapUsdc, agentPublicKey: wallet.agentPublicKey, installerRemovedTx: removalTx, atSignup: true } });

    // 5. Sponsored accounts (0 XLM) + EVM wallet.
    const t = await createSponsoredAccount({ newSecret: wallet.treasurySecret, sponsorSecret: env.SPONSOR_SECRET });
    const a = await createSponsoredAccount({ newSecret: wallet.agentSecret, sponsorSecret: env.SPONSOR_SECRET });
    const evm = await ensureUserEvmWallet({ userId: user.id, email: input.email });
    await updateStellarWallet(user.id, { status: "ready", statusDetail: null });
    events.emit({
      type: "wallet.provisioned",
      userId: user.id,
      network: "stellar:testnet",
      txHash: deployTxHash ?? wallet.deployTxHash ?? undefined,
      explorerUrl: stellarContractUrl(contractId),
      detail: { smartAccountId: contractId, treasury: wallet.treasuryPublicKey, agent: wallet.agentPublicKey, treasuryTx: t.txHash, agentTx: a.txHash, evm: evm.address, evmProvider: evm.provider, agentRuleId: ruleId },
    });
    return { user, smartAccountId: contractId, deployTxHash, agentRuleId: ruleId, agentRuleTxHash: ruleTx, treasuryPublicKey: wallet.treasuryPublicKey, agentPublicKey: wallet.agentPublicKey, evm: { provider: evm.provider, address: evm.address }, dailyCapUsdc: wallet.dailyCapUsdc };
  } catch (err) {
    await updateStellarWallet(user.id, { status: "error", statusDetail: (err as Error).message.slice(0, 500) });
    throw err;
  }
}

function deriveInstaller(credentialId: string, masterKey: string): { publicKey: string; secret: string } {
  return keypairFromSeed(createHmac("sha256", masterKey).update(`pera-installer:${credentialId}`).digest());
}

/** Signer of the `treasury-sweep` rule: derived from the master key, never stored (same secret every time). */
export function deriveSweeper(credentialId: string, masterKey: string): { publicKey: string; secret: string } {
  return keypairFromSeed(createHmac("sha256", masterKey).update(`pera-sweeper:${credentialId}`).digest());
}

async function hasSigner(contractId: string, publicKey: string): Promise<boolean> {
  const { Keypair } = await import("@stellar/stellar-sdk");
  const raw = Keypair.fromPublicKey(publicKey).rawPublicKey();
  const kit = createKit({ deployerSecret: loadEnv().SPONSOR_SECRET });
  attachKit(kit, contractId);
  const { result } = await kit.rules.get(0);
  return result.signers.some((s) => s.tag === "External" && Buffer.from(s.values[1]).equals(raw));
}

async function isDeployed(contractId: string): Promise<boolean> {
  try {
    const kit = createKit({ deployerSecret: loadEnv().SPONSOR_SECRET });
    attachKit(kit, contractId);
    const { result } = await kit.rules.get(0);
    return result.signers.length > 0;
  } catch {
    return false;
  }
}

async function assertPasskeyOwns(contractId: string, publicKey: Buffer, credentialId: string): Promise<void> {
  const kit = createKit({ deployerSecret: loadEnv().SPONSOR_SECRET });
  attachKit(kit, contractId);
  const { result } = await kit.rules.get(0);
  const expected = Buffer.concat([publicKey, Buffer.from(credentialId, "base64url")]);
  const ok = result.signers.some((s) => s.tag === "External" && Buffer.from(s.values[1]).equals(expected));
  if (!ok) throw Object.assign(new Error("the smart account's default rule is not owned by this passkey"), { statusCode: 403, code: "NOT_OWNER" });
}
