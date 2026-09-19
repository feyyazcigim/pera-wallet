import type { Hex } from "viem";
import { signTypedDataFor } from "./wallets";
import type { EvmWalletRef, TypedDataInput } from "./provider";

/**
 * Adapter for `@x402/evm`'s `ExactEvmScheme` (needs `address` + `signTypedData`). x402 exact on
 * EVM is an EIP-3009 authorization: the facilitator submits it, so the wallet needs no ETH.
 */
export function x402SignerFor(wallet: EvmWalletRef): { address: Hex; signTypedData: (typedData: TypedDataInput) => Promise<Hex> } {
  return {
    address: wallet.address as Hex,
    signTypedData: (typedData) => signTypedDataFor(wallet, typedData),
  };
}
