/** Idempotent bootstrap steps shared by bootstrap.ts and the smoke scripts. */
import {
  cmpUsdc,
  derivedKeys,
  ensureFunded,
  ensureUsdcTrustline,
  getBalances,
  getContractUsdcBalance,
  loadEnv,
  reloadEnv,
  sacTransfer,
  stellarAccountUrl,
  stellarContractUrl,
  subUsdc,
  type Env,
} from "@pera/core";
import { onrampTryToUsdc } from "@pera/anchor";
import { addAgentRule, deploySmartAccount, findAgentRuleId, resetKit } from "@pera/smart-account";
import { appendDeployment, upsertEnv } from "./deployments";

export const say = (msg: string) => console.log(`\n▶ ${msg}`);

export async function ensureKeysFunded(env: Env = loadEnv()): Promise<void> {
  const keys = derivedKeys(env);
  for (const [label, pub] of Object.entries({ owner: keys.ownerPub, agent: keys.agentPub, sponsor: keys.sponsorPub })) {
    const r = await ensureFunded(pub);
    if (r.funded) {
      console.log(`  friendbot funded ${label} ${pub}`);
      appendDeployment({ kind: "account", label: `${label} G-account (friendbot)`, id: pub, network: "stellar:testnet", url: stellarAccountUrl(pub) });
    } else console.log(`  ${label} ${pub} already exists`);
  }
}

export async function ensureTrustlines(env: Env = loadEnv()): Promise<void> {
  for (const [label, secret] of [
    ["owner", env.OWNER_SECRET],
    ["agent", env.AGENT_SECRET],
  ] as const) {
    const r = await ensureUsdcTrustline(secret);
    console.log(`  ${label} USDC trustline ${r.created ? `created (${r.txHash})` : "present"}`);
  }
}

export async function ensureSmartAccount(env: Env = loadEnv()): Promise<string> {
  if (env.SMART_ACCOUNT_ID) {
    console.log(`  smart account present ${env.SMART_ACCOUNT_ID}`);
    return env.SMART_ACCOUNT_ID;
  }
  const r = await deploySmartAccount({ ownerSecret: env.OWNER_SECRET, sponsorSecret: env.SPONSOR_SECRET });
  upsertEnv("SMART_ACCOUNT_ID", r.contractId);
  appendDeployment({ kind: "contract", label: "OpenZeppelin smart account (owner = Ed25519 signer on rule 0)", id: r.contractId, txHash: r.txHash, network: "stellar:testnet", url: r.contractUrl });
  console.log(`  smart account deployed ${r.contractId}\n  ${r.explorerUrl}`);
  resetKit();
  reloadEnv();
  return r.contractId;
}

export async function ensureAgentRule(env: Env = loadEnv()): Promise<number> {
  env = reloadEnv();
  if (env.AGENT_RULE_ID !== undefined) {
    console.log(`  agent rule present #${env.AGENT_RULE_ID}`);
    return env.AGENT_RULE_ID;
  }
  const existing = await findAgentRuleId();
  if (existing !== null) {
    upsertEnv("AGENT_RULE_ID", String(existing));
    console.log(`  agent rule found on-chain #${existing}`);
    reloadEnv();
    return existing;
  }
  const { agentPub } = derivedKeys(env);
  const r = await addAgentRule({ agentPublicKey: agentPub, capUsdc: env.AGENT_DAILY_CAP_USDC });
  upsertEnv("AGENT_RULE_ID", String(r.ruleId));
  appendDeployment({
    kind: "rule",
    label: `agent context rule CallContract(USDC) + spending_limit ${r.capUsdc} USDC / ${r.periodLedgers} ledgers`,
    id: `${env.SMART_ACCOUNT_ID} rule #${r.ruleId}`,
    txHash: r.txHash,
    network: "stellar:testnet",
    url: r.explorerUrl,
    notes: `agent signer ${agentPub}`,
  });
  console.log(`  agent rule created #${r.ruleId} cap ${r.capUsdc} USDC\n  ${r.explorerUrl}`);
  reloadEnv();
  return r.ruleId;
}

/** On-ramps TRY until the owner holds at least `minUsdc`. */
export async function ensureOwnerUsdc(minUsdc: string, env: Env = loadEnv()): Promise<string> {
  const { ownerPub } = derivedKeys(env);
  let bal = (await getBalances(ownerPub)).usdc;
  if (cmpUsdc(bal, minUsdc) >= 0) {
    console.log(`  owner USDC ${bal} ≥ ${minUsdc}`);
    return bal;
  }
  console.log(`  owner USDC ${bal} < ${minUsdc}; on-ramping ${env.BOOTSTRAP_ONRAMP_TRY} TRY …`);
  const { start, tx } = await onrampTryToUsdc({
    accountSecret: env.OWNER_SECRET,
    amountTry: env.BOOTSTRAP_ONRAMP_TRY,
    onStatus: (t) => console.log(`    anchor status → ${t.status}`),
  });
  appendDeployment({
    kind: "tx",
    label: `anchor onramp ${tx.amountIn} TRY → ${tx.amountOut} USDC (anchor tx ${start.id})`,
    id: ownerPub,
    txHash: tx.stellarTransactionId,
    network: "stellar:testnet",
    url: tx.stellarTransactionId ? `https://stellar.expert/explorer/testnet/tx/${tx.stellarTransactionId}` : undefined,
  });
  bal = (await getBalances(ownerPub)).usdc;
  console.log(`  owner USDC now ${bal}`);
  return bal;
}

/** Owner G → smart account USDC transfer until the smart account holds at least `minUsdc`. */
export async function ensureSmartAccountUsdc(minUsdc: string, env: Env = loadEnv()): Promise<string> {
  if (!env.SMART_ACCOUNT_ID) throw new Error("no smart account");
  const bal = await getContractUsdcBalance(env.SMART_ACCOUNT_ID);
  if (cmpUsdc(bal, minUsdc) >= 0) {
    console.log(`  smart account USDC ${bal} ≥ ${minUsdc}`);
    return bal;
  }
  const amount = subUsdc(minUsdc, bal);
  const r = await sacTransfer({ fromSecret: env.OWNER_SECRET, to: env.SMART_ACCOUNT_ID, amountUsdc: amount, sponsorSecret: env.SPONSOR_SECRET });
  appendDeployment({ kind: "tx", label: `owner → smart account ${amount} USDC`, id: env.SMART_ACCOUNT_ID, txHash: r.hash, network: "stellar:testnet", url: r.explorerUrl, notes: stellarContractUrl(env.SMART_ACCOUNT_ID) });
  const after = await getContractUsdcBalance(env.SMART_ACCOUNT_ID);
  console.log(`  smart account funded +${amount} USDC → ${after}\n  ${r.explorerUrl}`);
  return after;
}
