import { createHash, webcrypto } from "node:crypto";

/** Subset of the WebAuthn `AuthenticationResponseJSON` we verify. */
export interface AssertionJSON {
  id: string;
  rawId?: string;
  response: {
    clientDataJSON: string; // base64url
    authenticatorData: string; // base64url
    signature: string; // base64url (DER)
    userHandle?: string | null;
  };
  type?: string;
}

export interface VerifyParams {
  assertion: AssertionJSON;
  /** 65-byte uncompressed P-256 public key (as stored from smart-account-kit's registration). */
  publicKey: Uint8Array;
  expectedChallenge: string; // base64url
  expectedOrigins: string[];
  expectedRpId: string;
  requireUserVerification?: boolean;
}

export interface VerifyResult {
  ok: true;
  credentialId: string;
  signCount: number;
  userVerified: boolean;
}

const b64u = (s: string) => Buffer.from(s, "base64url");

/**
 * Verifies a WebAuthn assertion against a raw P-256 key without any external library:
 * checks clientData (type/challenge/origin), rpIdHash, flags, then ECDSA-SHA256 over
 * `authenticatorData || sha256(clientDataJSON)`.
 */
export async function verifyAssertion(p: VerifyParams): Promise<VerifyResult> {
  const clientDataBuf = b64u(p.assertion.response.clientDataJSON);
  const clientData = JSON.parse(clientDataBuf.toString("utf8")) as { type: string; challenge: string; origin: string };
  if (clientData.type !== "webauthn.get") throw new Error(`unexpected clientData.type ${clientData.type}`);
  if (clientData.challenge !== p.expectedChallenge) throw new Error("challenge mismatch");
  if (!p.expectedOrigins.includes(clientData.origin)) throw new Error(`origin ${clientData.origin} not allowed`);

  const authData = b64u(p.assertion.response.authenticatorData);
  if (authData.length < 37) throw new Error("authenticatorData too short");
  const rpIdHash = createHash("sha256").update(p.expectedRpId).digest();
  if (!authData.subarray(0, 32).equals(rpIdHash)) throw new Error("rpIdHash mismatch");
  const flags = authData[32]!;
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  if (!userPresent) throw new Error("user not present");
  if (p.requireUserVerification && !userVerified) throw new Error("user verification required");
  const signCount = authData.readUInt32BE(33);

  const signed = Buffer.concat([authData, createHash("sha256").update(clientDataBuf).digest()]);
  const key = await webcrypto.subtle.importKey("raw", p.publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sig = derToRaw(b64u(p.assertion.response.signature));
  const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, signed);
  if (!ok) throw new Error("invalid signature");
  return { ok: true, credentialId: p.assertion.id, signCount, userVerified };
}

/** DER ECDSA signature → 64-byte r||s (WebCrypto verify wants the raw form). */
export function derToRaw(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error("bad DER signature");
  let offset = 2;
  if (der[1]! & 0x80) offset = 2 + (der[1]! & 0x7f);
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("bad DER integer");
    const len = der[offset + 1]!;
    let v = der.subarray(offset + 2, offset + 2 + len);
    offset += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) throw new Error("integer too long");
    return Buffer.concat([Buffer.alloc(32 - v.length), v]);
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

/** Normalises a 65-byte raw key or an SPKI DER key to the raw 65-byte form. */
export function toRawP256(pub: Uint8Array): Uint8Array {
  if (pub.length === 65 && pub[0] === 0x04) return pub;
  // SPKI: ... 03 42 00 04 <64 bytes>
  const idx = Buffer.from(pub).indexOf(Buffer.from([0x03, 0x42, 0x00, 0x04]));
  if (idx >= 0 && pub.length >= idx + 4 + 64) return pub.subarray(idx + 3, idx + 3 + 65);
  throw new Error("unsupported public key encoding (expected raw 65-byte or SPKI P-256)");
}
