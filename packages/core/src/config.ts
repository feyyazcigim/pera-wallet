import { existsSync } from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { Keypair } from "@stellar/stellar-sdk";
import { z } from "zod";

const StellarSecret = z.string().regex(/^S[A-Z2-7]{55}$/, "expected a Stellar secret key (S…)");
const StellarAccount = z.string().regex(/^G[A-Z2-7]{55}$/, "expected a Stellar account id (G…)");
const ContractId = z.string().regex(/^C[A-Z2-7]{55}$/, "expected a Soroban contract id (C…)");
const EvmPrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex key");
const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed EVM address");
const DecimalUsdc = z.string().regex(/^\d+(\.\d{1,7})?$/, "expected a decimal USDC amount");

/** dotenv writes `KEY=` as an empty string; treat that as "unset". */
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), schema.optional());

export const EnvSchema = z.object({
  /** Legacy single-user demo keys (scripts). Multi-user wallets live in the database. */
  OWNER_SECRET: opt(StellarSecret),
  AGENT_SECRET: opt(StellarSecret),
  SPONSOR_SECRET: StellarSecret,
  EVM_SPONSOR_PRIVATE_KEY: opt(EvmPrivateKey),

  DEFINDEX_API_KEY: opt(z.string().startsWith("sk_")),
  X402_FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  OZ_FACILITATOR_API_KEY: opt(z.string()),

  SMART_ACCOUNT_ID: opt(ContractId),
  AGENT_RULE_ID: opt(z.coerce.number().int().nonnegative()),
  VAULT_ID: opt(ContractId),

  AGENT_DAILY_CAP_USDC: DecimalUsdc.default("10"),
  YIELD_RESERVE_USDC: DecimalUsdc.default("5"),
  BOOTSTRAP_ONRAMP_TRY: z.string().regex(/^\d+(\.\d{1,2})?$/).default("3000"),
  AUTOPILOT: z.enum(["on", "off"]).default("on"),

  API_BEARER_TOKEN: z.string().min(6).default("change-me"),
  DATABASE_URL: opt(z.string()),
  WALLET_MASTER_KEY: z.string().min(16).default("dev-master-key-change-me-please"),
  PASSKEY_RP_ID: z.string().default("localhost"),
  PASSKEY_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
  PRIVY_APP_ID: opt(z.string()),
  PRIVY_APP_SECRET: opt(z.string()),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: opt(z.string()),
  PRIVY_GAS_SPONSORSHIP: z.enum(["on", "off"]).default("on"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  RESOURCE_SERVER_URL: z.string().url().default("http://localhost:4000"),
  EVENTS_FILE: z.string().default("./data/events.jsonl"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),

  MERCHANT_STELLAR_ADDRESS: opt(StellarAccount),
  MERCHANT_EVM_ADDRESS: opt(EvmAddress),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedRoot: string | undefined;
/** Repo root = nearest ancestor of cwd containing pnpm-workspace.yaml (falls back to cwd). */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) {
      dir = process.cwd();
      break;
    }
    dir = parent;
  }
  cachedRoot = dir;
  return dir;
}

export function envFilePath(): string {
  return path.join(repoRoot(), ".env");
}

let cachedEnv: Env | undefined;

/**
 * Loads `.env` from the repo root (process env always wins, so Dokploy variables override),
 * validates it and caches the result. Exits the process with a readable error on failure.
 */
export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const file = envFilePath();
  if (existsSync(file)) dotenvConfig({ path: file, quiet: true });
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    console.error(`Invalid environment (${file}):\n${lines.join("\n")}\n\nRun \`pnpm keys\` to generate keys, then \`pnpm bootstrap\`.`);
    process.exit(1);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Forget the cached env (after bootstrap writes new ids into .env). */
export function reloadEnv(): Env {
  cachedEnv = undefined;
  for (const k of ["SMART_ACCOUNT_ID", "AGENT_RULE_ID", "VAULT_ID"]) delete process.env[k];
  return loadEnv();
}

export function resolveEventsFile(env: Env = loadEnv()): string {
  return path.isAbsolute(env.EVENTS_FILE) ? env.EVENTS_FILE : path.join(repoRoot(), env.EVENTS_FILE);
}

export interface Bootstrapped {
  SMART_ACCOUNT_ID: string;
  AGENT_RULE_ID: number;
  VAULT_ID?: string;
}

/** Throws unless the smart account has been deployed and the agent rule created. */
export function requireBootstrapped(env: Env = loadEnv()): Bootstrapped {
  if (!env.SMART_ACCOUNT_ID || env.AGENT_RULE_ID === undefined) {
    throw new Error("Not bootstrapped: SMART_ACCOUNT_ID / AGENT_RULE_ID missing. Run `pnpm bootstrap`.");
  }
  return { SMART_ACCOUNT_ID: env.SMART_ACCOUNT_ID, AGENT_RULE_ID: env.AGENT_RULE_ID, VAULT_ID: env.VAULT_ID };
}

export interface DerivedKeys {
  ownerPub: string;
  agentPub: string;
  sponsorPub: string;
}

/** Public keys of the legacy single-user demo keys (throws if OWNER/AGENT are unset). */
export function derivedKeys(env: Env = loadEnv()): DerivedKeys {
  if (!env.OWNER_SECRET || !env.AGENT_SECRET) throw new Error("OWNER_SECRET / AGENT_SECRET not set (single-user demo keys); use the multi-user API instead");
  return {
    ownerPub: Keypair.fromSecret(env.OWNER_SECRET).publicKey(),
    agentPub: Keypair.fromSecret(env.AGENT_SECRET).publicKey(),
    sponsorPub: Keypair.fromSecret(env.SPONSOR_SECRET).publicKey(),
  };
}

export function sponsorPublicKey(env: Env = loadEnv()): string {
  return Keypair.fromSecret(env.SPONSOR_SECRET).publicKey();
}
