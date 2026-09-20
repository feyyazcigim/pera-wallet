/**
 * smart-account-kit wiring for the one action that needs the passkey after sign-up: changing the cap.
 * Ported from apps/web (the reference client); loaded lazily so the landing page never pays for it.
 */
import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import { Client as SmartAccountClient } from "smart-account-kit-bindings";

// Testnet constants (also served by GET /status of the API).
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const ACCOUNT_WASM_HASH = "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";
export const WEBAUTHN_VERIFIER = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
export const ED25519_VERIFIER = "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4";

let kit: SmartAccountKit | undefined;

function getKit(): SmartAccountKit {
  kit ??= new SmartAccountKit({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    accountWasmHash: ACCOUNT_WASM_HASH,
    webauthnVerifierAddress: WEBAUTHN_VERIFIER,
    ed25519VerifierAddress: ED25519_VERIFIER,
    rpId: location.hostname,
    rpName: "Pera Agent Wallet",
    allowedOrigins: [location.origin],
    indexerUrl: false,
    contextRuleProbe: { enabled: true, maxRuleId: 8, maxConsecutiveMisses: 3 },
    storage: new IndexedDBStorage(),
  });
  return kit;
}

/**
 * Re-attach the kit to the user's smart account. `connectWallet()` requires the indexer's birth claim, so
 * the client and ids are set directly (pinned to smart-account-kit 0.8.0) and the credential's public key
 * is put in local storage for `signAdmin`.
 */
async function attach(p: { contractId: string; credentialId: string; publicKeyB64u: string | null }): Promise<SmartAccountKit> {
  const k = getKit();
  k.wallet = new SmartAccountClient({ contractId: p.contractId, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
  const priv = k as unknown as { _contractId?: string; _credentialId?: string; storage?: { get(id: string): Promise<unknown>; save(c: unknown): Promise<void> } };
  priv._contractId = p.contractId;
  priv._credentialId = p.credentialId;
  if (priv.storage && !(await priv.storage.get(p.credentialId)) && p.publicKeyB64u) {
    await priv.storage.save({ credentialId: p.credentialId, publicKey: b64uToBytes(p.publicKeyB64u), contractId: p.contractId, createdAt: Date.now() });
  }
  return k;
}

function b64uToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

/**
 * Sign a kit-serialised smart-account transaction with the owner's passkey (one Face ID prompt) → XDR.
 * `execute` carries a policy's set_spending_limit; `add_policy` attaches the weekly window to an older rule.
 */
export async function signWithPasskey(wallet: { contractId: string; credentialId: string; publicKeyB64u: string | null }, json: string, method: "execute" | "add_policy" | "add_context_rule" = "execute"): Promise<string> {
  const k = await attach(wallet);
  const built = method === "add_policy" ? k.wallet!.fromJSON.add_policy(json) : method === "add_context_rule" ? k.wallet!.fromJSON.add_context_rule(json) : k.wallet!.fromJSON.execute(json);
  const tx = built as unknown as Parameters<SmartAccountKit["signAdmin"]>[0]; // signAdmin only cares about the auth entries, not the return type
  const signed = await k.signAdmin(tx, { resolveContextRuleIds: () => [0] }); // rule 0 = the passkey
  return signed.toXDR();
}
