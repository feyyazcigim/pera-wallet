import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadEnv } from "@pera/core";

/**
 * AES-256-GCM for custodial secrets at rest. `WALLET_MASTER_KEY` is any string; it is hashed to
 * 32 bytes. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
function masterKey(): Buffer {
  const raw = loadEnv().WALLET_MASTER_KEY;
  if (!raw || raw.length < 16) throw new Error("WALLET_MASTER_KEY missing or too short (≥16 chars)");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, data] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("bad ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
