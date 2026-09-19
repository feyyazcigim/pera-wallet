/** smart-account-kit driven exactly like the browser would, with the device's software passkey. */
import { MemoryStorage, SmartAccountKit } from "smart-account-kit";
import { Client as SmartAccountClient } from "smart-account-kit-bindings";
import { NETWORK_PASSPHRASE, RPC_URL, SMART_ACCOUNT, HORIZON_URL } from "@pera/core";
import type { SoftwarePasskey } from "@pera/passkey";
import type { DeviceRecord } from "./device";

export function browserLikeKit(passkey: SoftwarePasskey): SmartAccountKit {
  return new SmartAccountKit({
    rpcUrl: RPC_URL,
    horizonUrl: HORIZON_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    accountWasmHash: SMART_ACCOUNT.accountWasmHash,
    webauthnVerifierAddress: SMART_ACCOUNT.webauthnVerifier,
    ed25519VerifierAddress: SMART_ACCOUNT.ed25519Verifier,
    rpId: passkey.rpId,
    rpName: "Pera Agent Wallet",
    allowedOrigins: [passkey.origin],
    indexerUrl: false,
    contextRuleProbe: { enabled: true, maxRuleId: 8, maxConsecutiveMisses: 3 },
    storage: new MemoryStorage(),
    webAuthn: {
      startRegistration: passkey.startRegistration as never,
      startAuthentication: passkey.startAuthentication as never,
    },
  });
}

/**
 * Reconnects a kit to the device's smart account without the (indexer-bound) `connectWallet()`:
 * attach the contract client, restore the credential in storage and set the active credential id.
 * Mirrors what the API does server-side; pinned to smart-account-kit 0.8.0.
 */
export async function attachDevice(kit: SmartAccountKit, passkey: SoftwarePasskey, record: DeviceRecord): Promise<void> {
  if (!record.contractId) throw new Error("device has no smart account yet — run `pera-agent register`");
  kit.wallet = new SmartAccountClient({ contractId: record.contractId, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
  const k = kit as unknown as { _contractId?: string; _credentialId?: string; storage?: { save(c: unknown): Promise<void> } };
  k._contractId = record.contractId;
  k._credentialId = record.credentialId;
  await k.storage?.save({ credentialId: record.credentialId, publicKey: passkey.publicKey, contractId: record.contractId, createdAt: Date.now() });
}
