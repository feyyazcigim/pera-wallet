import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer as createX402StellarSigner, ExactStellarScheme } from "@x402/stellar";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_SEPOLIA_CAIP2, loadEnv, RPC_URL, STELLAR_CAIP2, type Caip2Network } from "@pera/core";

export type Net = Caip2Network;

let stellar: x402HTTPClient | undefined;
let evm: x402HTTPClient | undefined;

/** One HTTP client per network so offer selection is deterministic. */
export function httpClientFor(net: Net): x402HTTPClient {
  const env = loadEnv();
  if (net === STELLAR_CAIP2) {
    if (!stellar) {
      const signer = createX402StellarSigner(env.AGENT_SECRET, STELLAR_CAIP2);
      stellar = new x402HTTPClient(new x402Client().register("stellar:*", new ExactStellarScheme(signer, { url: RPC_URL })));
    }
    return stellar;
  }
  if (net === BASE_SEPOLIA_CAIP2) {
    if (!env.EVM_SPONSOR_PRIVATE_KEY) throw new Error("EVM_SPONSOR_PRIVATE_KEY missing — cannot pay on Base Sepolia");
    if (!evm) {
      const account = privateKeyToAccount(env.EVM_SPONSOR_PRIVATE_KEY as `0x${string}`);
      evm = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))));
    }
    return evm;
  }
  throw new Error(`unsupported network ${net as string}`);
}

export function evmPayerAddress(): string | undefined {
  const env = loadEnv();
  return env.EVM_SPONSOR_PRIVATE_KEY ? privateKeyToAccount(env.EVM_SPONSOR_PRIVATE_KEY as `0x${string}`).address : undefined;
}
