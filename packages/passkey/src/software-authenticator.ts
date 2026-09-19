/**
 * A software passkey for tests and headless end-to-end runs: implements the two functions
 * smart-account-kit takes through its `webAuthn` config (`startRegistration`, `startAuthentication`)
 * and produces standard WebAuthn JSON responses that both the kit and `verifyAssertion` accept.
 * Never use this for real users — the private key lives in process memory.
 */
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";

export interface SoftwarePasskey {
  credentialId: string; // base64url
  publicKey: Uint8Array; // raw 65 bytes
  /** PKCS#8 PEM — persist this to reuse the "device" passkey across runs. */
  privateKeyPem: string;
  rpId: string;
  origin: string;
  signCount: number;
  startRegistration: (options: { optionsJSON: { challenge: string; rp?: { id?: string }; user?: { name?: string } } }) => Promise<Record<string, unknown>>;
  startAuthentication: (options: { optionsJSON: { challenge: string; rpId?: string } }) => Promise<Record<string, unknown>>;
  /** Sign a login challenge from the API (same shape as a browser assertion). */
  assert: (challenge: string) => Promise<Record<string, unknown>>;
}

export function createSoftwarePasskey(p: { rpId: string; origin: string; privateKeyPem?: string; credentialId?: string }): SoftwarePasskey {
  let privateKey: KeyObject;
  let publicKey: KeyObject;
  if (p.privateKeyPem) {
    privateKey = createPrivateKey(p.privateKeyPem);
    publicKey = createPublicKey(privateKey);
  } else {
    ({ privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }));
  }
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const spki = publicKey.export({ type: "spki", format: "der" });
  const raw = spki.subarray(spki.length - 65);
  const credentialId = p.credentialId ?? randomBytes(16).toString("base64url");
  const rpIdHash = createHash("sha256").update(p.rpId).digest();
  const state = { signCount: 0 };

  const authenticatorData = (flags: number) => {
    const buf = Buffer.alloc(37);
    rpIdHash.copy(buf, 0);
    buf[32] = flags;
    buf.writeUInt32BE(state.signCount, 33);
    return buf;
  };
  const clientData = (type: "webauthn.create" | "webauthn.get", challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: p.origin, crossOrigin: false }));
  const sign = (key: KeyObject, data: Buffer) => createSign("SHA256").update(data).sign(key); // DER

  const assert = async (challenge: string) => {
    state.signCount += 1;
    const cd = clientData("webauthn.get", challenge);
    const ad = authenticatorData(0x05); // UP + UV
    const sig = sign(privateKey, Buffer.concat([ad, createHash("sha256").update(cd).digest()]));
    return {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: { clientDataJSON: cd.toString("base64url"), authenticatorData: ad.toString("base64url"), signature: sig.toString("base64url"), userHandle: null },
    };
  };

  return {
    credentialId,
    publicKey: new Uint8Array(raw),
    privateKeyPem,
    rpId: p.rpId,
    origin: p.origin,
    get signCount() {
      return state.signCount;
    },
    startRegistration: async ({ optionsJSON }) => {
      const cd = clientData("webauthn.create", optionsJSON.challenge);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: cd.toString("base64url"),
          attestationObject: "",
          authenticatorData: authenticatorData(0x45).toString("base64url"),
          publicKey: Buffer.from(raw).toString("base64url"),
          publicKeyAlgorithm: -7,
          transports: ["internal"],
        },
      };
    },
    startAuthentication: async ({ optionsJSON }) => assert(optionsJSON.challenge),
    assert,
  };
}
