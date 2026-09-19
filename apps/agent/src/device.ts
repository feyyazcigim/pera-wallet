/**
 * The CLI's "device": a software passkey (P-256 key in ~/.pera/passkey.json) and the API session.
 * It exercises exactly the browser flow (smart-account-kit createWallet / signAdmin with an injected
 * WebAuthn implementation) so the passkey path can be tested headlessly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSoftwarePasskey, type SoftwarePasskey } from "@pera/passkey";
import { loadEnv } from "@pera/core";

const dir = process.env.PERA_HOME ?? path.join(os.homedir(), ".pera");
const passkeyFile = path.join(dir, "passkey.json");
const sessionFile = path.join(dir, "session.json");

export interface DeviceRecord {
  credentialId: string;
  privateKeyPem: string;
  publicKey: string; // base64url raw 65
  contractId?: string;
  rpId: string;
  origin: string;
  displayName?: string;
}

export function deviceOrigin(): string {
  return loadEnv().PASSKEY_ORIGINS.split(",")[0]!.trim();
}

export function loadDevice(): DeviceRecord | null {
  if (!existsSync(passkeyFile)) return null;
  return JSON.parse(readFileSync(passkeyFile, "utf8")) as DeviceRecord;
}

export function saveDevice(d: DeviceRecord): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(passkeyFile, JSON.stringify(d, null, 2), { mode: 0o600 });
}

/** Returns the software passkey for this device (creating and persisting one when missing). */
export function devicePasskey(): { passkey: SoftwarePasskey; record: DeviceRecord } {
  const env = loadEnv();
  const existing = loadDevice();
  const passkey = createSoftwarePasskey({ rpId: existing?.rpId ?? env.PASSKEY_RP_ID, origin: existing?.origin ?? deviceOrigin(), privateKeyPem: existing?.privateKeyPem, credentialId: existing?.credentialId });
  const record: DeviceRecord = existing ?? { credentialId: passkey.credentialId, privateKeyPem: passkey.privateKeyPem, publicKey: Buffer.from(passkey.publicKey).toString("base64url"), rpId: passkey.rpId, origin: passkey.origin };
  if (!existing) saveDevice(record);
  return { passkey, record };
}

export function loadSession(): { token: string; expiresAt: string; userId?: string } | null {
  if (!existsSync(sessionFile)) return null;
  return JSON.parse(readFileSync(sessionFile, "utf8"));
}

export function saveSession(s: { token: string; expiresAt: string; userId?: string }): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(sessionFile, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function clearSession(): void {
  if (existsSync(sessionFile)) writeFileSync(sessionFile, "{}");
}
