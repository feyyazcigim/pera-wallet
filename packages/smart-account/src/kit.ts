import { SmartAccountKit, type ContractSigner, type SelectedSigner, type TransactionResult } from "smart-account-kit";
import { Client as SmartAccountClient } from "smart-account-kit-bindings";
import { childLogger, HORIZON_URL, loadEnv, NETWORK_PASSPHRASE, RPC_URL, SMART_ACCOUNT } from "@pera/core";
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
    // Required by the kit even though this backend never uses passkeys.
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

let kitPromise: Promise<SmartAccountKit> | undefined;

/**
 * Process-wide kit bound to `SMART_ACCOUNT_ID` with the owner and agent Ed25519 keys registered
 * as local signers. Throws if the account has not been bootstrapped yet.
 */
export function getKit(): Promise<SmartAccountKit> {
  kitPromise ??= (async () => {
    const env = loadEnv();
    if (!env.SMART_ACCOUNT_ID) throw new Error("SMART_ACCOUNT_ID missing — run `pnpm bootstrap`");
    const kit = createKit({ deployerSecret: env.SPONSOR_SECRET, allowedOrigin: env.PUBLIC_API_URL });
    attachKit(kit, env.SMART_ACCOUNT_ID);
    kit.externalSigners.addEd25519FromSecret(env.OWNER_SECRET);
    kit.externalSigners.addEd25519FromSecret(env.AGENT_SECRET);
    await assertAttached(kit);
    log.info({ smartAccount: env.SMART_ACCOUNT_ID }, "kit attached");
    return kit;
  })();
  kitPromise.catch(() => {
    kitPromise = undefined;
  });
  return kitPromise;
}

/** Drop the memoised kit (after bootstrap deploys a new account). */
export function resetKit(): void {
  kitPromise = undefined;
}

/** Selected signers for the rule's signer set; asserts every one has a local Ed25519 key. */
export function selectSigners(kit: SmartAccountKit, signers: ContractSigner[], label: string): SelectedSigner[] {
  const selected = kit.multiSigners.buildSelectedSigners(signers);
  if (selected.length !== signers.length) {
    throw new Error(`${label}: only ${selected.length}/${signers.length} signers have local keys (kit would submit an under-signed tx)`);
  }
  return selected;
}

/** Owner = signers of the Default rule (id 0). */
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
