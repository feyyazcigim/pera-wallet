import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import { Client as SmartAccountClient } from "smart-account-kit-bindings";

// Testnet constants (also served by GET /status of the API).
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const ACCOUNT_WASM_HASH = "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";
export const WEBAUTHN_VERIFIER = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
export const ED25519_VERIFIER = "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4";

let kit: SmartAccountKit | undefined;

export function getKit(): SmartAccountKit {
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
 * Re-attach the kit to the user's smart account after a reload. `connectWallet()` requires the
 * indexer's birth claim, so we set the client and ids directly (pinned to smart-account-kit 0.8.0)
 * and make sure the credential (public key) is in local storage for `signAdmin`.
 */
export async function attach(p: { contractId: string; credentialId: string; publicKeyB64u: string | null }): Promise<SmartAccountKit> {
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

export function bytesToB64u(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}
