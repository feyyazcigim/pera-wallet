import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { createEd25519Signer as createKitEd25519Signer } from "smart-account-kit";
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
 * External signer = the owner. A rule with signers and no policy requires all its signers to
 * sign, so the owner is the admin. The kit's own `createWallet()` only deploys passkey-owned
 * accounts, so we drive the generated bindings directly; SPONSOR is source and fee payer.
 */
export async function deploySmartAccount(p: { ownerSecret: string; sponsorSecret: string }): Promise<DeployResult> {
  const owner = Keypair.fromSecret(p.ownerSecret);
  const sponsor = Keypair.fromSecret(p.sponsorSecret);
  const ownerSigner = createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, owner.rawPublicKey());

  const tx = await SmartAccountClient.deploy(
    { signers: [ownerSigner], policies: new Map<string, unknown>() },
    {
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      wasmHash: SMART_ACCOUNT.accountWasmHash,
      format: "hex",
      salt: randomBytes(32),
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
