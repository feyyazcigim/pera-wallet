import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { createEd25519Signer as createKitEd25519Signer, createWebAuthnSigner } from "smart-account-kit";
import { Client as SmartAccountClient } from "smart-account-kit-bindings";
import { childLogger, NETWORK_PASSPHRASE, RPC_URL, SMART_ACCOUNT, stellarContractUrl, stellarTxUrl } from "@pera/core";

const log = childLogger("smart-account.deploy");

export interface DeployResult {
  contractId: string;
  txHash: string;
  explorerUrl: string;
  contractUrl: string;
}

/**
 * Deploys an OpenZeppelin smart account whose Default rule (id 0) holds a single Ed25519
 * External signer = the owner (legacy single-user demo). SPONSOR is source and fee payer.
 */
export async function deploySmartAccount(p: { ownerSecret: string; sponsorSecret: string }): Promise<DeployResult> {
  const owner = Keypair.fromSecret(p.ownerSecret);
  return deployWithSigner({ signer: createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, owner.rawPublicKey()), sponsorSecret: p.sponsorSecret, salt: randomBytes(32) });
}

/**
 * Deploys a smart account owned by a WebAuthn passkey (65-byte P-256 key + credential id), for
 * flows where the browser could not submit the deploy itself. Salt = sha256(credentialId), like
 * the kit, so the contract id is the one the kit derives for that credential and deployer.
 */
export async function deployPasskeySmartAccount(p: { publicKey: Uint8Array; credentialId: string; sponsorSecret: string }): Promise<DeployResult> {
  const { createHash } = await import("node:crypto");
  const salt = createHash("sha256").update(Buffer.from(p.credentialId, "base64url")).digest();
  return deployWithSigner({ signer: createWebAuthnSigner(SMART_ACCOUNT.webauthnVerifier, p.publicKey, p.credentialId), sponsorSecret: p.sponsorSecret, salt });
}

async function deployWithSigner(p: { signer: ReturnType<typeof createKitEd25519Signer>; sponsorSecret: string; salt: Buffer }): Promise<DeployResult> {
  const sponsor = Keypair.fromSecret(p.sponsorSecret);
  const tx = await SmartAccountClient.deploy(
    { signers: [p.signer], policies: new Map<string, unknown>() },
    {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      wasmHash: SMART_ACCOUNT.accountWasmHash,
      format: "hex",
      salt: p.salt,
      publicKey: sponsor.publicKey(),
      ...basicNodeSigner(sponsor, NETWORK_PASSPHRASE),
      timeoutInSeconds: 60,
    },
  );
  const sent = await tx.signAndSend();
  const contractId = sent.result.options.contractId;
  const txHash = sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash;
  if (!contractId || !txHash) throw new Error("deploy returned no contract id / hash");
  log.info({ contractId, txHash }, "smart account deployed");
  return { contractId, txHash, explorerUrl: stellarTxUrl(txHash), contractUrl: stellarContractUrl(contractId) };
}
