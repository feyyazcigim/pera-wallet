import { loadEnv } from "@pera/core";

export interface Plan {
  skill: "weather" | "summary" | "quote";
  url: string;
  prefer: "auto" | "stellar" | "evm";
  reason: string;
}

/**
 * Deterministic task planner (no LLM on the critical path): maps a natural-language task to the
 * paywalled endpoints the agent knows about. Unknown tasks are rejected rather than guessed.
 */
export function planTask(task: string, prefer: "auto" | "stellar" | "evm" = "auto"): Plan[] {
  const rsUrl = loadEnv().RESOURCE_SERVER_URL;
  if (!rsUrl) throw new Error("RESOURCE_SERVER_URL is not set: the keyword planner only knows the demo paywalls. Use `pera-agent pay <url>` with any x402 URL.");
  const rs = rsUrl.replace(/\/$/, "");
  const t = task.toLowerCase();
  const plans: Plan[] = [];
  if (/weather|hava|forecast|temperature|istanbul/.test(t)) plans.push({ skill: "weather", url: `${rs}/api/stellar/weather`, prefer, reason: "weather is served by the Stellar-paid endpoint" });
  if (/summary|özet|ozet|report|market/.test(t)) plans.push({ skill: "summary", url: `${rs}/api/base/summary`, prefer, reason: "summary is served by the Base Sepolia-paid endpoint (CCTP bridge)" });
  if (/quote|motivat|alıntı|alinti/.test(t)) plans.push({ skill: "quote", url: `${rs}/api/any/quote`, prefer, reason: "quote endpoint accepts both networks; router prefers Stellar" });
  if (plans.length === 0) throw new Error(`I don't know how to do "${task}". Try: weather, summary, quote.`);
  return plans;
}
