import path from "node:path";
import { mkdirSync } from "node:fs";
import postgres from "postgres";
import { childLogger, repoRoot } from "@pera/core";

const log = childLogger("db");

/** Minimal driver-agnostic interface: `$1`-style parameters, rows as plain objects. */
export interface Db {
  kind: "postgres" | "pglite";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

let dbPromise: Promise<Db> | undefined;

/**
 * `DATABASE_URL` → Postgres (Dokploy service). Otherwise an embedded PGlite database under
 * `data/pglite` so local development needs no daemon. Same SQL dialect either way.
 */
export function getDb(): Promise<Db> {
  dbPromise ??= open();
  return dbPromise;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = postgres(url, { max: 10, idle_timeout: 30, connect_timeout: 15, onnotice: () => undefined });
    await sql`select 1`;
    log.info({ host: safeHost(url) }, "connected to postgres");
    return {
      kind: "postgres",
      query: async <T,>(q: string, params: unknown[] = []) => (await sql.unsafe(q, params as never[])) as unknown as T[],
      close: () => sql.end({ timeout: 5 }),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(repoRoot(), "data", "pglite");
  mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  log.info({ dir }, "using embedded PGlite (set DATABASE_URL for Postgres)");
  return {
    kind: "pglite",
    query: async <T,>(q: string, params: unknown[] = []) => (await pg.query<T>(q, params)).rows,
    close: () => pg.close(),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}
