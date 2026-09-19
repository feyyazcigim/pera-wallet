import { childLogger } from "@pera/core";
import { getDb } from "./client";

const log = childLogger("db.migrate");

const STATEMENTS = [
  `create table if not exists users (
     id text primary key,
     display_name text not null,
     email text,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists passkeys (
     credential_id text primary key,
     user_id text not null references users(id),
     public_key bytea not null,
     transports text,
     created_at timestamptz not null default now(),
     last_used_at timestamptz
   )`,
  `create table if not exists sessions (
     token text primary key,
     user_id text not null references users(id),
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,
  `create table if not exists auth_challenges (
     challenge text primary key,
     purpose text not null,
     credential_id text,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,
  `create table if not exists stellar_wallets (
     user_id text primary key references users(id),
     smart_account_id text not null unique,
     credential_id text not null,
     treasury_public_key text not null,
     treasury_secret_enc text not null,
     agent_public_key text not null,
     agent_secret_enc text not null,
     agent_rule_id integer,
     daily_cap_usdc text not null,
     status text not null default 'provisioning',
     status_detail text,
     deploy_tx_hash text,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,
  `create table if not exists evm_wallets (
     user_id text primary key references users(id),
     provider text not null default 'privy',
     privy_wallet_id text,
     address text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists events (
     id text primary key,
     user_id text,
     ts timestamptz not null,
     type text not null,
     amount_usdc text,
     network text,
     tx_hash text,
     explorer_url text,
     detail jsonb
   )`,
  `alter table evm_wallets add column if not exists secret_enc text`,
  `alter table evm_wallets add column if not exists privy_user_id text`,
  `create index if not exists evm_wallets_address on evm_wallets (lower(address))`,
  `create index if not exists events_user_ts on events (user_id, ts desc)`,
  `create index if not exists sessions_user on sessions (user_id)`,
  `create table if not exists deposit_orders (
     reference text primary key,
     user_id text not null references users(id),
     anchor_tx_id text not null,
     iban text not null,
     bank_name text,
     status text not null default 'open',
     created_at timestamptz not null default now()
   )`,
  `create index if not exists deposit_orders_user on deposit_orders (user_id, created_at desc)`,
  `create table if not exists agent_rules (
     user_id text primary key references users(id),
     weekly_cap_usdc text,
     max_per_call_usdc text,
     allowed_networks text not null default 'stellar:testnet,eip155:84532',
     updated_at timestamptz not null default now()
   )`,
];

let done: Promise<void> | undefined;

export function migrate(): Promise<void> {
  done ??= (async () => {
    const db = await getDb();
    for (const s of STATEMENTS) await db.query(s);
    log.info({ kind: db.kind }, "migrations applied");
  })();
  return done;
}
