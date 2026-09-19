import { Address, hash, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "@pera/core";

/** smart-account-kit's shared default deployer (sign-only key derived from a public seed). */
export const DEFAULT_DEPLOYER_PUBLIC_KEY = Keypair.fromRawEd25519Seed(hash(Buffer.from("openzeppelin-smart-account-kit"))).publicKey();

/**
 * Contract id the kit derives for a passkey: deployer = shared default deployer, salt = sha256(credentialId).
 * Lets the CLI resume a registration whose deploy already landed.
 */
export function expectedContractId(credentialId: string, deployerPublicKey = DEFAULT_DEPLOYER_PUBLIC_KEY): string {
  const salt = hash(Buffer.from(credentialId, "base64url"));
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({ address: new Address(deployerPublicKey).toScAddress(), salt }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
