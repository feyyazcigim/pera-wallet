import { loadEnv, logger } from "@pera/core";
import { buildApp } from "./app";
import { startAutopilotLoop } from "./autopilot";

const env = loadEnv();
const app = await buildApp();
if (env.AUTOPILOT === "on") startAutopilotLoop(60_000);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
logger.info({ port: env.PORT, autopilot: env.AUTOPILOT }, "pera api listening");
