import { childLogger, createSponsoredAccount, events, generateKeypair, loadEnv, stellarContractUrl, stellarTxUrl } from "@pera/core";
import { createPasskey, createStellarWallet, createUser, getPasskey, getStellarWallet, getUser, updateStellarWallet, type User } from "@pera/db";
import { ensureUserEvmWallet } from "@pera/evm";
import { createKit, attachKit, submitRelayerPayload } from "@pera/smart-account";
import { createKitEd25519SignerKeyData } from "./keydata";

const log = childLogger("api.provisioning");

export interface RegisterInput {
  displayName: string;
  email?: string;
  credentialId: string;
  /** raw 65-byte P-256 public key, base64url */
  publicKey: string;
  contractId: string;
  relayerPayload?: { func: string; auth: string[] };
  dailyCapUsdc?: string;
}

export interface RegisterResult {
  user: User;
  smartAccountId: string;
  deployTxHash?: string;
  treasuryPublicKey: string;
  agentPublicKey: string;
  evm: { provider: string; address: string };
  dailyCapUsdc: string;
}

/**
 * Registration = passkey-owned smart account (deployed sponsored from the browser's payload) +
 * custodial treasury/agent accounts with sponsored reserves + EVM wallet. The user never holds XLM or ETH.
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const env = loadEnv();
  const publicKey = Buffer.from(input.publicKey, "base64url");
  // Registration is resumable: a passkey that exists without a wallet continues provisioning.
  const existingPasskey = await getPasskey(input.credentialId);
  if (existingPasskey) {
    if (await getStellarWallet(existingPasskey.userId)) throw Object.assign(new Error("this passkey is already registered"), { statusCode: 409, code: "ALREADY_REGISTERED" });
    if (!Buffer.from(existingPasskey.publicKey).equals(publicKey)) throw Object.assign(new Error("credential id already used with a different key"), { statusCode: 409, code: "ALREADY_REGISTERED" });
  }
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) throw Object.assign(new Error("publicKey must be a raw 65-byte P-256 key"), { statusCode: 400 });

  // 1. Deploy the smart account (sponsor pays) unless it already exists on-chain.
  let deployTxHash: string | undefined;
  const deployed = await isDeployed(input.contractId);
  if (!deployed) {
    if (!input.relayerPayload) throw Object.assign(new Error("smart account not deployed and no relayerPayload provided"), { statusCode: 400 });
    const r = await submitRelayerPayload(input.relayerPayload);
    deployTxHash = r.hash;
    log.info({ contractId: input.contractId, hash: r.hash }, "passkey smart account deployed (sponsored)");
  }
  // 2. Prove the passkey owns rule 0 of that account.
  await assertPasskeyOwns(input.contractId, publicKey, input.credentialId);

  // 3. Persist user + passkey (or resume the existing user).
  let user: User;
  if (existingPasskey) {
    user = (await getUser(existingPasskey.userId))!;
  } else {
    user = await createUser({ displayName: input.displayName, email: input.email });
    await createPasskey({ credentialId: input.credentialId, userId: user.id, publicKey, transports: "internal" });
    events.emit({ type: "user.registered", userId: user.id, detail: { displayName: user.displayName, smartAccountId: input.contractId } });
  }

  // 4. Custodial accounts with sponsored reserves (0 XLM on the user side).
  const treasury = generateKeypair();
  const agent = generateKeypair();
  const dailyCapUsdc = input.dailyCapUsdc ?? env.AGENT_DAILY_CAP_USDC;
  const wallet = await createStellarWallet({
    userId: user.id,
    smartAccountId: input.contractId,
    credentialId: input.credentialId,
    treasuryPublicKey: treasury.publicKey,
    treasurySecret: treasury.secret,
    agentPublicKey: agent.publicKey,
    agentSecret: agent.secret,
    dailyCapUsdc,
  });
  try {
    const t = await createSponsoredAccount({ newSecret: treasury.secret, sponsorSecret: env.SPONSOR_SECRET });
    const a = await createSponsoredAccount({ newSecret: agent.secret, sponsorSecret: env.SPONSOR_SECRET });
    const evm = await ensureUserEvmWallet({ userId: user.id, email: input.email });
    await updateStellarWallet(user.id, { status: "deployed", statusDetail: null, deployTxHash: deployTxHash ?? null });
    events.emit({
      type: "wallet.provisioned",
      userId: user.id,
      network: "stellar:testnet",
      txHash: deployTxHash,
      explorerUrl: deployTxHash ? stellarTxUrl(deployTxHash) : stellarContractUrl(input.contractId),
      detail: { smartAccountId: input.contractId, treasury: treasury.publicKey, agent: agent.publicKey, treasuryTx: t.txHash, agentTx: a.txHash, evm: evm.address, evmProvider: evm.provider },
    });
    return { user, smartAccountId: input.contractId, deployTxHash, treasuryPublicKey: treasury.publicKey, agentPublicKey: agent.publicKey, evm: { provider: evm.provider, address: evm.address }, dailyCapUsdc: wallet.dailyCapUsdc };
  } catch (err) {
    await updateStellarWallet(user.id, { status: "error", statusDetail: (err as Error).message.slice(0, 500) });
    throw err;
  }
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
  const expected = createKitEd25519SignerKeyData(publicKey, credentialId);
  const ok = result.signers.some((s) => s.tag === "External" && Buffer.from(s.values[1]).equals(expected));
  if (!ok) throw Object.assign(new Error("the smart account's default rule is not owned by this passkey"), { statusCode: 403, code: "NOT_OWNER" });
}
