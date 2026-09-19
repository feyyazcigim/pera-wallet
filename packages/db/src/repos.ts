import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./client";
import { decryptSecret, encryptSecret } from "./crypto";

// ---------------------------------------------------------------------------- users / passkeys
export interface User {
  id: string;
  displayName: string;
  email: string | null;
  createdAt: string;
}

const rowToUser = (r: Record<string, unknown>): User => ({
  id: String(r.id),
  displayName: String(r.display_name),
  email: (r.email as string | null) ?? null,
  createdAt: new Date(r.created_at as string).toISOString(),
});

export async function createUser(p: { displayName: string; email?: string }): Promise<User> {
  const db = await getDb();
  const id = randomUUID();
  const rows = await db.query("insert into users (id, display_name, email) values ($1, $2, $3) returning *", [id, p.displayName, p.email ?? null]);
  return rowToUser(rows[0]!);
}

export async function getUser(id: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db.query("select * from users where id = $1", [id]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export interface Passkey {
  credentialId: string;
  userId: string;
  publicKey: Uint8Array;
  transports: string | null;
}

export async function createPasskey(p: { credentialId: string; userId: string; publicKey: Uint8Array; transports?: string }): Promise<void> {
  const db = await getDb();
  await db.query("insert into passkeys (credential_id, user_id, public_key, transports) values ($1, $2, $3, $4)", [p.credentialId, p.userId, Buffer.from(p.publicKey), p.transports ?? null]);
}

export async function getPasskey(credentialId: string): Promise<Passkey | null> {
  const db = await getDb();
  const rows = await db.query("select * from passkeys where credential_id = $1", [credentialId]);
  const r = rows[0];
  if (!r) return null;
  return { credentialId: String(r.credential_id), userId: String(r.user_id), publicKey: new Uint8Array(r.public_key as Uint8Array), transports: (r.transports as string | null) ?? null };
}

export async function touchPasskey(credentialId: string): Promise<void> {
  const db = await getDb();
  await db.query("update passkeys set last_used_at = now() where credential_id = $1", [credentialId]);
}

// ---------------------------------------------------------------------------- challenges / sessions
export async function createChallenge(p: { purpose: "register" | "login"; credentialId?: string; ttlMs?: number }): Promise<string> {
  const db = await getDb();
  const challenge = randomBytes(32).toString("base64url");
  await db.query("insert into auth_challenges (challenge, purpose, credential_id, expires_at) values ($1, $2, $3, $4)", [challenge, p.purpose, p.credentialId ?? null, new Date(Date.now() + (p.ttlMs ?? 5 * 60_000))]);
  return challenge;
}

/** Deletes and returns the challenge if it exists and is unexpired. */
export async function consumeChallenge(challenge: string, purpose: "register" | "login"): Promise<{ credentialId: string | null } | null> {
  const db = await getDb();
  const rows = await db.query("delete from auth_challenges where challenge = $1 and purpose = $2 and expires_at > now() returning credential_id", [challenge, purpose]);
  return rows[0] ? { credentialId: (rows[0].credential_id as string | null) ?? null } : null;
}

export async function createSession(userId: string, ttlMs = 7 * 24 * 3600_000): Promise<{ token: string; expiresAt: string }> {
  const db = await getDb();
  const token = `ps_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.query("insert into sessions (token, user_id, expires_at) values ($1, $2, $3)", [token, userId, expiresAt]);
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function getSessionUser(token: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db.query("select u.* from sessions s join users u on u.id = s.user_id where s.token = $1 and s.expires_at > now()", [token]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function deleteSession(token: string): Promise<void> {
  const db = await getDb();
  await db.query("delete from sessions where token = $1", [token]);
}

// ---------------------------------------------------------------------------- stellar wallets
export type StellarWalletStatus = "provisioning" | "deployed" | "ready" | "error";

export interface StellarWallet {
  userId: string;
  smartAccountId: string;
  credentialId: string;
  treasuryPublicKey: string;
  treasurySecret: string;
  agentPublicKey: string;
  agentSecret: string;
  agentRuleId: number | null;
  dailyCapUsdc: string;
  status: StellarWalletStatus;
  statusDetail: string | null;
  deployTxHash: string | null;
}

const rowToStellar = (r: Record<string, unknown>): StellarWallet => ({
  userId: String(r.user_id),
  smartAccountId: String(r.smart_account_id),
  credentialId: String(r.credential_id),
  treasuryPublicKey: String(r.treasury_public_key),
  treasurySecret: decryptSecret(String(r.treasury_secret_enc)),
  agentPublicKey: String(r.agent_public_key),
  agentSecret: decryptSecret(String(r.agent_secret_enc)),
  agentRuleId: r.agent_rule_id === null || r.agent_rule_id === undefined ? null : Number(r.agent_rule_id),
  dailyCapUsdc: String(r.daily_cap_usdc),
  status: String(r.status) as StellarWalletStatus,
  statusDetail: (r.status_detail as string | null) ?? null,
  deployTxHash: (r.deploy_tx_hash as string | null) ?? null,
});

export async function createStellarWallet(p: {
  userId: string;
  smartAccountId: string;
  credentialId: string;
  treasuryPublicKey: string;
  treasurySecret: string;
  agentPublicKey: string;
  agentSecret: string;
  dailyCapUsdc: string;
}): Promise<StellarWallet> {
  const db = await getDb();
  const rows = await db.query(
    `insert into stellar_wallets (user_id, smart_account_id, credential_id, treasury_public_key, treasury_secret_enc, agent_public_key, agent_secret_enc, daily_cap_usdc)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [p.userId, p.smartAccountId, p.credentialId, p.treasuryPublicKey, encryptSecret(p.treasurySecret), p.agentPublicKey, encryptSecret(p.agentSecret), p.dailyCapUsdc],
  );
  return rowToStellar(rows[0]!);
}

export async function getStellarWallet(userId: string): Promise<StellarWallet | null> {
  const db = await getDb();
  const rows = await db.query("select * from stellar_wallets where user_id = $1", [userId]);
  return rows[0] ? rowToStellar(rows[0]) : null;
}

export async function getStellarWalletBySmartAccount(smartAccountId: string): Promise<StellarWallet | null> {
  const db = await getDb();
  const rows = await db.query("select * from stellar_wallets where smart_account_id = $1", [smartAccountId]);
  return rows[0] ? rowToStellar(rows[0]) : null;
}

export async function updateStellarWallet(userId: string, patch: Partial<Pick<StellarWallet, "agentRuleId" | "dailyCapUsdc" | "status" | "statusDetail" | "deployTxHash">>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.agentRuleId !== undefined) push("agent_rule_id", patch.agentRuleId);
  if (patch.dailyCapUsdc !== undefined) push("daily_cap_usdc", patch.dailyCapUsdc);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.statusDetail !== undefined) push("status_detail", patch.statusDetail);
  if (patch.deployTxHash !== undefined) push("deploy_tx_hash", patch.deployTxHash);
  if (sets.length === 0) return;
  params.push(userId);
  await db.query(`update stellar_wallets set ${sets.join(", ")}, updated_at = now() where user_id = $${params.length}`, params);
}

// ---------------------------------------------------------------------------- evm wallets
export interface EvmWallet {
  userId: string;
  provider: "privy";
  privyWalletId: string;
  privyUserId: string | null;
  address: string;
}

const rowToEvm = (r: Record<string, unknown>): EvmWallet => ({
  userId: String(r.user_id),
  provider: "privy",
  privyWalletId: String(r.privy_wallet_id),
  privyUserId: (r.privy_user_id as string | null) ?? null,
  address: String(r.address),
});

export async function upsertEvmWallet(p: { userId: string; privyWalletId: string; privyUserId?: string; address: string }): Promise<EvmWallet> {
  const db = await getDb();
  const rows = await db.query(
    `insert into evm_wallets (user_id, provider, privy_wallet_id, privy_user_id, address) values ($1, 'privy', $2, $3, $4)
     on conflict (user_id) do update set privy_wallet_id = excluded.privy_wallet_id, privy_user_id = excluded.privy_user_id, address = excluded.address returning *`,
    [p.userId, p.privyWalletId, p.privyUserId ?? null, p.address],
  );
  return rowToEvm(rows[0]!);
}

export async function getEvmWallet(userId: string): Promise<EvmWallet | null> {
  const db = await getDb();
  const rows = await db.query("select * from evm_wallets where user_id = $1", [userId]);
  return rows[0] ? rowToEvm(rows[0]) : null;
}

export async function getEvmWalletByAddress(address: string): Promise<EvmWallet | null> {
  const db = await getDb();
  const rows = await db.query("select * from evm_wallets where lower(address) = lower($1)", [address]);
  return rows[0] ? rowToEvm(rows[0]) : null;
}

// ---------------------------------------------------------------------------- events
export interface EventRow {
  id: string;
  userId: string | null;
  ts: string;
  type: string;
  amountUsdc?: string;
  network?: string;
  txHash?: string;
  explorerUrl?: string;
  detail?: Record<string, unknown>;
}

export async function insertEvent(e: EventRow): Promise<void> {
  const db = await getDb();
  await db.query("insert into events (id, user_id, ts, type, amount_usdc, network, tx_hash, explorer_url, detail) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing", [
    e.id,
    e.userId,
    new Date(e.ts),
    e.type,
    e.amountUsdc ?? null,
    e.network ?? null,
    e.txHash ?? null,
    e.explorerUrl ?? null,
    e.detail ? JSON.stringify(e.detail) : null,
  ]);
}

export async function listEvents(p: { userId?: string | null; limit?: number }): Promise<EventRow[]> {
  const db = await getDb();
  const limit = Math.min(p.limit ?? 200, 1000);
  const rows = p.userId
    ? await db.query("select * from events where user_id = $1 order by ts desc limit $2", [p.userId, limit])
    : await db.query("select * from events order by ts desc limit $1", [limit]);
  return rows.map((r) => ({
    id: String(r.id),
    userId: (r.user_id as string | null) ?? null,
    ts: new Date(r.ts as string).toISOString(),
    type: String(r.type),
    amountUsdc: (r.amount_usdc as string | null) ?? undefined,
    network: (r.network as string | null) ?? undefined,
    txHash: (r.tx_hash as string | null) ?? undefined,
    explorerUrl: (r.explorer_url as string | null) ?? undefined,
    detail: typeof r.detail === "string" ? (JSON.parse(r.detail) as Record<string, unknown>) : ((r.detail as Record<string, unknown> | null) ?? undefined),
  }));
}

export async function listStellarWallets(status?: StellarWalletStatus): Promise<StellarWallet[]> {
  const db = await getDb();
  const rows = status ? await db.query("select * from stellar_wallets where status = $1", [status]) : await db.query("select * from stellar_wallets");
  return rows.map(rowToStellar);
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ n: string | number }>("select count(*)::int as n from users");
  return Number(rows[0]?.n ?? 0);
}

// ---- agent rules (router-enforced; the daily cap lives on-chain in the spending_limit policy) ----

export interface AgentRules {
  /** Max USDC the agent may pay over x402 in a rolling 7 days; null = no weekly limit. */
  weeklyCapUsdc: string | null;
  /** Max price of a single paywall call; null = no per-call limit. */
  maxPerCallUsdc: string | null;
  /** CAIP-2 networks the agent may pay on. */
  allowedNetworks: string[];
}

export const DEFAULT_AGENT_RULES: AgentRules = { weeklyCapUsdc: null, maxPerCallUsdc: null, allowedNetworks: ["stellar:testnet", "eip155:84532"] };

export async function getAgentRules(userId: string): Promise<AgentRules> {
  const db = await getDb();
  const rows = await db.query("select * from agent_rules where user_id = $1", [userId]);
  const r = rows[0];
  if (!r) return { ...DEFAULT_AGENT_RULES, allowedNetworks: [...DEFAULT_AGENT_RULES.allowedNetworks] };
  return {
    weeklyCapUsdc: (r.weekly_cap_usdc as string | null) ?? null,
    maxPerCallUsdc: (r.max_per_call_usdc as string | null) ?? null,
    allowedNetworks: String(r.allowed_networks ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

export async function upsertAgentRules(userId: string, rules: AgentRules): Promise<AgentRules> {
  const db = await getDb();
  await db.query(
    `insert into agent_rules (user_id, weekly_cap_usdc, max_per_call_usdc, allowed_networks, updated_at) values ($1, $2, $3, $4, now())
     on conflict (user_id) do update set weekly_cap_usdc = excluded.weekly_cap_usdc, max_per_call_usdc = excluded.max_per_call_usdc, allowed_networks = excluded.allowed_networks, updated_at = now()`,
    [userId, rules.weeklyCapUsdc, rules.maxPerCallUsdc, rules.allowedNetworks.join(",")],
  );
  return getAgentRules(userId);
}

/** Amounts of the user's settled x402 payments since `sinceIso` (decimal USDC strings). */
export async function listPaidAmountsSince(userId: string, sinceIso: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query("select amount_usdc from events where user_id = $1 and type = 'x402.paid' and ts >= $2 and amount_usdc is not null", [userId, new Date(sinceIso)]);
  return rows.map((r) => String(r.amount_usdc));
}
