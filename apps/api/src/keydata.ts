/** WebAuthn signer key_data as the OpenZeppelin verifier stores it: pubkey(65) || credentialId bytes. */
export function createKitEd25519SignerKeyData(publicKey: Buffer, credentialId: string): Buffer {
  return Buffer.concat([publicKey, Buffer.from(credentialId, "base64url")]);
}
