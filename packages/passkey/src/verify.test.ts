import { describe, expect, it } from "vitest";
import { createSoftwarePasskey } from "./software-authenticator";
import { verifyAssertion, type AssertionJSON } from "./verify";

describe("passkey verification", () => {
  it("verifies a software assertion and rejects tampering", async () => {
    const pk = createSoftwarePasskey({ rpId: "localhost", origin: "http://localhost:5173" });
    const challenge = Buffer.from("hello-challenge").toString("base64url");
    const assertion = (await pk.assert(challenge)) as unknown as AssertionJSON;
    const ok = await verifyAssertion({ assertion, publicKey: pk.publicKey, expectedChallenge: challenge, expectedOrigins: ["http://localhost:5173"], expectedRpId: "localhost", requireUserVerification: true });
    expect(ok.credentialId).toBe(pk.credentialId);
    expect(ok.userVerified).toBe(true);
    await expect(verifyAssertion({ assertion, publicKey: pk.publicKey, expectedChallenge: "other", expectedOrigins: ["http://localhost:5173"], expectedRpId: "localhost" })).rejects.toThrow(/challenge/);
    await expect(verifyAssertion({ assertion, publicKey: pk.publicKey, expectedChallenge: challenge, expectedOrigins: ["http://evil"], expectedRpId: "localhost" })).rejects.toThrow(/origin/);
    const other = createSoftwarePasskey({ rpId: "localhost", origin: "http://localhost:5173" });
    await expect(verifyAssertion({ assertion, publicKey: other.publicKey, expectedChallenge: challenge, expectedOrigins: ["http://localhost:5173"], expectedRpId: "localhost" })).rejects.toThrow(/signature/);
  });
});
