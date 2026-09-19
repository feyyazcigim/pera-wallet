import { Account, Keypair, xdr } from "@stellar/stellar-sdk";
import { SmartAccountKit, resimulateAndAssemble, type ContractSigner, type SelectedSigner, type TransactionResult } from "smart-account-kit";
import { Client as SmartAccountClient } from "smart-account-kit-bindings";
import { childLogger, getRpc, HORIZON_URL, loadEnv, NETWORK_PASSPHRASE, RPC_URL, SMART_ACCOUNT, stellarTxUrl, waitForTx, type UserWalletContext } from "@pera/core";
import { decodeKitError, SmartAccountOpError } from "./errors";

const log = childLogger("smart-account");

export interface CreateKitOptions {
  /** Funded backend key: transaction source and fee payer for every kit operation (no relayer). */
  deployerSecret: string;
  allowedOrigin?: string;
}

export function createKit(opts: CreateKitOptions): SmartAccountKit {
  return new SmartAccountKit({
    rpcUrl: RPC_URL,
    horizonUrl: HORIZON_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    accountWasmHash: SMART_ACCOUNT.accountWasmHash,
    webauthnVerifierAddress: SMART_ACCOUNT.webauthnVerifier,
    ed25519VerifierAddress: SMART_ACCOUNT.ed25519Verifier,
    deployerSecret: opts.deployerSecret,
    indexerUrl: false,
    contextRuleProbe: { enabled: true, maxRuleId: 8, maxConsecutiveMisses: 3 },
    allowedOrigins: [opts.allowedOrigin ?? "http://localhost:3000"],
    timeoutInSeconds: 60,
  });
}

/**
 * Points a kit at an already-deployed smart account without a passkey ceremony.
 * `connectWallet()` is WebAuthn-bound, so we set the public `wallet` client and the
 * (TypeScript-private) `_contractId` directly. Verified against smart-account-kit 0.8.0 —
 * the version is pinned exactly and `assertAttached()` is the canary.
 */
export function attachKit(kit: SmartAccountKit, contractId: string): void {
  kit.wallet = new SmartAccountClient({ contractId, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
  (kit as unknown as { _contractId?: string })._contractId = contractId;
}

export async function assertAttached(kit: SmartAccountKit): Promise<void> {
  if (!kit.isConnected || !kit.contractId) throw new Error("smart-account-kit attach hack failed: kit reports not connected");
  const { result } = await kit.rules.get(0);
  if (!result || result.signers.length < 1) throw new Error("smart account default rule has no signers");
}

const kits = new Map<string, Promise<SmartAccountKit>>();

/**
 * Kit bound to one user's smart account with the user's custodial agent key registered as a
 * local Ed25519 signer (and the legacy owner key when running the single-user demo).
 * SPONSOR is source and fee payer for everything.
 */
export function getKitFor(ctx: Pick<UserWalletContext, "smartAccountId" | "agentSecret"> & { ownerSecret?: string }): Promise<SmartAccountKit> {
  let p = kits.get(ctx.smartAccountId);
  if (!p) {
    p = (async () => {
      const env = loadEnv();
      const kit = createKit({ deployerSecret: env.SPONSOR_SECRET, allowedOrigin: env.PUBLIC_API_URL });
      attachKit(kit, ctx.smartAccountId);
      kit.externalSigners.addEd25519FromSecret(ctx.agentSecret);
      if (ctx.ownerSecret) kit.externalSigners.addEd25519FromSecret(ctx.ownerSecret);
      await assertAttached(kit);
      log.debug({ smartAccount: ctx.smartAccountId }, "kit attached");
      return kit;
    })();
    kits.set(ctx.smartAccountId, p);
    p.catch(() => kits.delete(ctx.smartAccountId));
  }
  return p;
}

export function resetKit(smartAccountId?: string): void {
  if (smartAccountId) kits.delete(smartAccountId);
  else kits.clear();
}

/** Legacy single-user kit built from OWNER_SECRET / AGENT_SECRET / SMART_ACCOUNT_ID in .env. */
export function legacyContext(): UserWalletContext & { ownerSecret: string } {
  const env = loadEnv();
  if (!env.SMART_ACCOUNT_ID || !env.OWNER_SECRET || !env.AGENT_SECRET) throw new Error("single-user demo not bootstrapped (SMART_ACCOUNT_ID / OWNER_SECRET / AGENT_SECRET)");
  return {
    userId: "demo",
    smartAccountId: env.SMART_ACCOUNT_ID,
    credentialId: "",
    treasurySecret: env.OWNER_SECRET,
    treasuryPub: Keypair.fromSecret(env.OWNER_SECRET).publicKey(),
    agentSecret: env.AGENT_SECRET,
    agentPub: Keypair.fromSecret(env.AGENT_SECRET).publicKey(),
    agentRuleId: env.AGENT_RULE_ID,
    dailyCapUsdc: env.AGENT_DAILY_CAP_USDC,
    ownerSecret: env.OWNER_SECRET,
  };
}

/** Selected signers for the rule's signer set; asserts every one has a local Ed25519 key. */
export function selectSigners(kit: SmartAccountKit, signers: ContractSigner[], label: string): SelectedSigner[] {
  const selected = kit.multiSigners.buildSelectedSigners(signers);
  if (selected.length !== signers.length) {
    throw new Error(`${label}: only ${selected.length}/${signers.length} signers have local keys (kit would submit an under-signed tx)`);
  }
  return selected;
}

/** Owner = signers of the Default rule (id 0). Only usable when the owner is a local Ed25519 key (legacy demo). */
export async function ownerSelected(kit: SmartAccountKit): Promise<SelectedSigner[]> {
  const { result } = await kit.rules.get(0);
  return selectSigners(kit, result.signers, "owner rule 0");
}

/** Unwraps a kit `TransactionResult` into a hash or throws a decoded error. */
export function unwrapResult(res: TransactionResult, what: string): { hash: string; ledger?: number } {
  if (res.success) return { hash: res.hash, ledger: res.ledger };
  const decoded = decodeKitError(res.error);
  throw new SmartAccountOpError(`${what} failed: ${decoded.name ?? ""}${decoded.code !== null ? ` #${decoded.code}` : ""} ${decoded.message}`.trim(), decoded);
}

// ---------------------------------------------------------------------------------------------
// Passkey-owned accounts: the browser signs auth entries with the passkey, the backend
// re-simulates, sources and pays the transaction with SPONSOR.
// ---------------------------------------------------------------------------------------------

export interface SponsoredSubmit {
  hash: string;
  explorerUrl: string;
  ledger: number;
}

/**
 * Submits a host function + already-signed auth entries (what `kit.createWallet({ autoSubmit:false })`
 * returns as `relayerPayload`, or what we extract from a passkey-signed admin transaction).
 */
export async function submitSponsoredInvocation(p: { func: xdr.HostFunction; auth: xdr.SorobanAuthorizationEntry[]; sponsorSecret?: string }): Promise<SponsoredSubmit> {
  const env = loadEnv();
  const sponsor = Keypair.fromSecret(p.sponsorSecret ?? env.SPONSOR_SECRET);
  const rpc = getRpc();
  const acc = await rpc.getAccount(sponsor.publicKey());
  const tx = await resimulateAndAssemble({ rpc, networkPassphrase: NETWORK_PASSPHRASE, timeoutInSeconds: 60 }, new Account(acc.accountId(), acc.sequenceNumber()), p.func, p.auth);
  tx.sign(sponsor);
  const sent = await rpc.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    throw new SmartAccountOpError(`sponsored submit failed: ${sent.errorResult ? sent.errorResult.result().switch().name : sent.status}`, { code: null, message: sent.status });
  }
  const res = await waitForTx(sent.hash);
  return { hash: sent.hash, explorerUrl: stellarTxUrl(sent.hash), ledger: res.ledger };
}

/** `relayerPayload` from the browser kit: base64 XDR strings. */
export async function submitRelayerPayload(p: { func: string; auth: string[] }): Promise<SponsoredSubmit> {
  return submitSponsoredInvocation({
    func: xdr.HostFunction.fromXDR(p.func, "base64"),
    auth: p.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
  });
}

/**
 * A transaction the browser kit signed with the passkey (`kit.signAdmin(tx)` → `tx.toXDR()`):
 * extract its invoke-host-function op and resubmit it sponsored. The kit warns that signed
 * transactions must be re-simulated before submission — that is exactly what this does.
 */
export async function submitPasskeySignedXdr(p: { xdr: string; expectContract?: string }): Promise<SponsoredSubmit> {
  const env = xdr.TransactionEnvelope.fromXDR(p.xdr, "base64");
  const inner = env.switch().name === "envelopeTypeTxFeeBump" ? env.feeBump().tx().innerTx().v1().tx() : env.v1().tx();
  const ops = inner.operations();
  if (ops.length !== 1) throw new Error(`expected 1 operation, got ${ops.length}`);
  const body = ops[0]!.body();
  if (body.switch().name !== "invokeHostFunction") throw new Error(`expected invokeHostFunction, got ${body.switch().name}`);
  const op = body.invokeHostFunctionOp();
  const func = op.hostFunction();
  if (p.expectContract && func.switch().name === "hostFunctionTypeInvokeContract") {
    const target = func.invokeContract().contractAddress();
    const { Address } = await import("@stellar/stellar-sdk");
    const targetId = Address.fromScAddress(target).toString();
    if (targetId !== p.expectContract) throw new Error(`transaction targets ${targetId}, expected ${p.expectContract}`);
  }
  return submitSponsoredInvocation({ func, auth: op.auth() });
}
