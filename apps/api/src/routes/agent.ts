import type { FastifyInstance } from "fastify";
import { events } from "@pera/core";
import { attemptOverCap, getPolicyUsage, updateDailyCap } from "@pera/smart-account";
import { payFor } from "@pera/x402-router";
import { PayBody, PolicyBody } from "../schemas";
import { state } from "../state";

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/agent/policy", async () => getPolicyUsage(state.agentRuleId));

  app.post("/agent/policy", async (req) => {
    const { dailyCapUsdc } = PolicyBody.parse(req.body);
    const r = await updateDailyCap({ dailyCapUsdc, ruleId: state.agentRuleId });
    state.agentRuleId = r.ruleId;
    state.dailyCapUsdc = dailyCapUsdc;
    process.env.AGENT_DAILY_CAP_USDC = dailyCapUsdc;
    process.env.AGENT_RULE_ID = String(r.ruleId);
    const { reloadEnv } = await import("@pera/core");
    reloadEnv();
    return { ...r, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${r.txHash}` };
  });

  /** Runs the router; returns the paid response plus the events emitted during the call (timeline). */
  app.post("/agent/pay", async (req) => {
    const { url, prefer } = PayBody.parse(req.body);
    const timeline: unknown[] = [];
    const unsub = events.subscribe((e) => timeline.push(e));
    try {
      const result = await payFor(url, { prefer });
      return { ...result, timeline };
    } finally {
      unsub();
    }
  });

  app.post("/agent/pay/over-cap-demo", async (req) => {
    const body = (req.body ?? {}) as { amountUsdc?: string };
    const timeline: unknown[] = [];
    const unsub = events.subscribe((e) => timeline.push(e));
    try {
      const r = await attemptOverCap({ amountUsdc: body.amountUsdc, ruleId: state.agentRuleId });
      return { ...r, timeline };
    } finally {
      unsub();
    }
  });
}
