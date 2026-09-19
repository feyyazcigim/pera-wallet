import { toRawP256 } from "./verify";

/** Subset of WebAuthn `RegistrationResponseJSON` we consume (from @simplewebauthn/browser or the software passkey). */
export interface RegistrationJSON {
  id: string;
  rawId?: string;
  type?: string;
  response: {
    clientDataJSON: string; // base64url
    attestationObject?: string;
    authenticatorData?: string;
    publicKey?: string; // base64url, SPKI DER or raw 65 bytes
    publicKeyAlgorithm?: number;
    transports?: string[];
  };
}

export interface VerifiedRegistration {
  credentialId: string;
  /** raw 65-byte uncompressed P-256 key */
  publicKey: Uint8Array;
  transports?: string[];
}

/**
 * Validates the client data of a registration (type, challenge, origin) and extracts the credential's
 * P-256 public key from `response.publicKey` (the browser's `getPublicKey()` output). Attestation is not
 * verified: the key is bound to the on-chain smart account owner instead, which is what we rely on.
 */
export function verifyRegistration(p: { registration: RegistrationJSON; expectedChallenge: string; expectedOrigins: string[] }): VerifiedRegistration {
  const clientData = JSON.parse(Buffer.from(p.registration.response.clientDataJSON, "base64url").toString("utf8")) as { type: string; challenge: string; origin: string };
  if (clientData.type !== "webauthn.create") throw new Error(`unexpected clientData.type ${clientData.type}`);
  if (clientData.challenge !== p.expectedChallenge) throw new Error("challenge mismatch");
  if (!p.expectedOrigins.includes(clientData.origin)) throw new Error(`origin ${clientData.origin} not allowed`);
  if (!p.registration.response.publicKey) throw new Error("registration response has no publicKey (authenticator/browser did not expose it)");
  if (p.registration.response.publicKeyAlgorithm !== undefined && p.registration.response.publicKeyAlgorithm !== -7) throw new Error("only ES256 (P-256) passkeys are supported");
  const publicKey = toRawP256(Buffer.from(p.registration.response.publicKey, "base64url"));
  return { credentialId: p.registration.id, publicKey, transports: p.registration.response.transports };
}
