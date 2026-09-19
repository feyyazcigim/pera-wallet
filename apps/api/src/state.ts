import { childLogger, loadEnv, reloadEnv } from "@pera/core";
import { assertAttached, findAgentRuleId, getKit } from "@pera/smart-account";

const log = childLogger("api.state");

export interface RuntimeState {
  smartAccountId?: string;
  agentRuleId?: number;
  vaultId?: string;
  dailyCapUsdc: string;
  startedAt: string;
  kitReady: boolean;
  kitError?: string;
}

export const state: RuntimeState = {
  smartAccountId: undefined,
  agentRuleId: undefined,
  vaultId: undefined,
  dailyCapUsdc: "0",
  startedAt: new Date().toISOString(),
  kitReady: false,
};

/** Reads ids from env and verifies the smart-account attach hack (canary). Never throws. */
export async function initState(): Promise<RuntimeState> {
  const env = reloadEnv();
  state.smartAccountId = env.SMART_ACCOUNT_ID;
  state.agentRuleId = env.AGENT_RULE_ID;
  state.vaultId = env.VAULT_ID;
  state.dailyCapUsdc = env.AGENT_DAILY_CAP_USDC;
  if (!env.SMART_ACCOUNT_ID) {
    state.kitError = "not bootstrapped (SMART_ACCOUNT_ID missing)";
    log.warn(state.kitError);
    return state;
  }
  try {
    const kit = await getKit();
    await assertAttached(kit);
    const found = await findAgentRuleId();
    if (found !== null && found !== state.agentRuleId) {
      log.warn({ env: state.agentRuleId, onchain: found }, "AGENT_RULE_ID differs from on-chain rule; using on-chain id");
      state.agentRuleId = found;
      process.env.AGENT_RULE_ID = String(found);
      reloadEnv();
    }
    state.kitReady = true;
    state.kitError = undefined;
  } catch (err) {
    state.kitReady = false;
    state.kitError = (err as Error).message;
    log.error({ err: state.kitError }, "smart-account kit not ready");
  }
  return state;
}

export function currentEnv() {
  return loadEnv();
}
