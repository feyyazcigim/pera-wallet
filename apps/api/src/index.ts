import { loadEnv, logger } from "@pera/core";
import { startAutopilot } from "@pera/yield";
import { buildApp } from "./app";
import { initState } from "./state";

const env = loadEnv();
const app = await buildApp();
await initState();
if (env.AUTOPILOT === "on") startAutopilot({ intervalMs: 60_000 });

await app.listen({ port: env.PORT, host: "0.0.0.0" });
logger.info({ port: env.PORT, autopilot: env.AUTOPILOT }, "pera api listening");
