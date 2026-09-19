import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { createEd25519Signer as createKitEd25519Signer, createThresholdParams, createWebAuthnSigner } from "smart-account-kit";
import { Address, StrKey, hash, xdr } from "@stellar/stellar-sdk";
import { createKit } from "./kit";
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

/** Salt for a passkey-owned account: sha256(credentialId) — deterministic, so a registration can be resumed. */
export function passkeySalt(credentialId: string): Buffer {
  return hash(Buffer.from(credentialId, "base64url"));
}

/** Contract id the sponsor-deployed passkey account will get (Soroban contract id preimage). */
export function expectedPasskeyContractId(credentialId: string, sponsorPublicKey: string): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: new Address(sponsorPublicKey).toScAddress(), salt: passkeySalt(credentialId) })),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

/**
 * Deploys a smart account owned by a WebAuthn passkey (65-byte P-256 key + credential id). With
 * `installerPublicKey`, rule 0 also carries a temporary Ed25519 co-signer under a `simple_threshold(1)`
 * policy so the backend can install the agent rule right after deploy (one passkey ceremony for the
 * whole sign-up); the installer removes itself afterwards, leaving the passkey as the sole owner.
 */
export async function deployPasskeySmartAccount(p: { publicKey: Uint8Array; credentialId: string; sponsorSecret: string; installerPublicKey?: string }): Promise<DeployResult> {
  const signers = [createWebAuthnSigner(SMART_ACCOUNT.webauthnVerifier, p.publicKey, p.credentialId)];
  const policies = new Map<string, unknown>();
  if (p.installerPublicKey) {
    signers.push(createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, Keypair.fromPublicKey(p.installerPublicKey).rawPublicKey()));
    const kit = createKit({ deployerSecret: p.sponsorSecret });
    policies.set(SMART_ACCOUNT.thresholdPolicy, kit.convertPolicyParams("threshold", createThresholdParams(1)));
  }
  return deployWithSigners({ signers, policies, sponsorSecret: p.sponsorSecret, salt: passkeySalt(p.credentialId) });
}

async function deployWithSigner(p: { signer: ReturnType<typeof createKitEd25519Signer>; sponsorSecret: string; salt: Buffer }): Promise<DeployResult> {
  return deployWithSigners({ signers: [p.signer], policies: new Map(), sponsorSecret: p.sponsorSecret, salt: p.salt });
}

async function deployWithSigners(p: { signers: Array<ReturnType<typeof createKitEd25519Signer>>; policies: Map<string, unknown>; sponsorSecret: string; salt: Buffer }): Promise<DeployResult> {
  const sponsor = Keypair.fromSecret(p.sponsorSecret);
  const tx = await SmartAccountClient.deploy(
    { signers: p.signers, policies: p.policies },
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
