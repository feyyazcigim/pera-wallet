import { DefindexSDK, SupportedNetworks } from "@defindex/sdk";
import { DEFINDEX, loadEnv } from "@pera/core";

let sdk: DefindexSDK | undefined;

/** True when a DeFindex API key is configured; every vault step is skipped (never mocked) otherwise. */
export function isConfigured(): boolean {
  return Boolean(loadEnv().DEFINDEX_API_KEY);
}

export function getDefindex(): DefindexSDK {
  const env = loadEnv();
  if (!env.DEFINDEX_API_KEY) throw new Error("DEFINDEX_API_KEY missing — create one at https://console.defindex.io (API Keys)");
  sdk ??= new DefindexSDK({ apiKey: env.DEFINDEX_API_KEY, baseUrl: DEFINDEX.apiUrl, defaultNetwork: SupportedNetworks.TESTNET, timeout: 60_000 });
  return sdk;
}

export const NET = SupportedNetworks.TESTNET;

/** FREE tier allows 1 req/s (burst 5): serialise and space DeFindex calls. */
let last = 0;
let chain: Promise<unknown> = Promise.resolve();
export function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** DeFindex rejects with the raw API body (not an Error); normalise for logging. */
export function describeDefindexError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
