import { loadEnv, logger } from "@pera/core";
import { getEvmWallet, listStellarWallets } from "@pera/db";
import { startAutopilot } from "@pera/yield";
import { buildApp } from "./app";
import { toContext } from "./context";

const env = loadEnv();
const app = await buildApp();
if (env.AUTOPILOT === "on") {
  startAutopilot(async () => {
    const wallets = await listStellarWallets("ready");
    return Promise.all(wallets.map(async (w) => toContext(w, undefined)));
  }, { intervalMs: 60_000 });
}
void getEvmWallet; // keep import for future per-user autopilot extensions

await app.listen({ port: env.PORT, host: "0.0.0.0" });
logger.info({ port: env.PORT, autopilot: env.AUTOPILOT }, "pera api listening");
