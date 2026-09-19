import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer as createX402StellarSigner, ExactStellarScheme } from "@x402/stellar";
import { ExactEvmScheme } from "@x402/evm";
import { BASE_SEPOLIA_CAIP2, RPC_URL, STELLAR_CAIP2, type Caip2Network } from "@pera/core";
import { x402SignerFor, type EvmWalletRef } from "@pera/evm";

export type Net = Caip2Network;

const stellarClients = new Map<string, x402HTTPClient>();
const evmClients = new Map<string, x402HTTPClient>();

/** Stellar payer = the user's agent float account (classic Ed25519 key). */
export function stellarHttpClient(agentSecret: string): x402HTTPClient {
  let c = stellarClients.get(agentSecret);
  if (!c) {
    const signer = createX402StellarSigner(agentSecret, STELLAR_CAIP2);
    c = new x402HTTPClient(new x402Client().register("stellar:*", new ExactStellarScheme(signer, { url: RPC_URL })));
    stellarClients.set(agentSecret, c);
  }
  return c;
}

/** EVM payer = the user's wallet (Privy or local) signing EIP-3009 authorizations; the facilitator pays gas. */
export function evmHttpClient(wallet: EvmWalletRef): x402HTTPClient {
  let c = evmClients.get(wallet.address);
  if (!c) {
    c = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(x402SignerFor(wallet))));
    evmClients.set(wallet.address, c);
  }
  return c;
}

export function httpClientFor(net: Net, p: { agentSecret: string; evmWallet?: EvmWalletRef }): x402HTTPClient {
  if (net === STELLAR_CAIP2) return stellarHttpClient(p.agentSecret);
  if (net === BASE_SEPOLIA_CAIP2) {
    if (!p.evmWallet) throw new Error("no EVM wallet for this user");
    return evmHttpClient(p.evmWallet);
  }
  throw new Error(`unsupported network ${net as string}`);
}
