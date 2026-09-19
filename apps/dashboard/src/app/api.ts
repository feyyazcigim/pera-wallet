/**
 * Pera API client — typed against apps/api (routes/*.ts, schemas.ts) and openapi.yaml.
 * All USDC / TRY amounts cross the wire as decimal STRINGS; pages only see the normalised number types below.
 */
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { demoBackend } from "./demo";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const RESOURCE_SERVER_URL: string = import.meta.env.VITE_RESOURCE_SERVER_URL ?? "http://localhost:4000";

/* ── wire types (what the API returns) ────────────────────────────────── */
type WireMe = {
  user: { id: string; displayName: string; email: string | null; createdAt: string };
  wallets: {
    stellar: {
      smartAccountId: string; smartAccountUrl: string; credentialId: string; passkeyPublicKey: string | null;
      treasury: string; treasuryUrl: string; agent: string; agentUrl: string;
      agentRuleId: number | null; agentAuthorised: boolean; dailyCapUsdc: string; status: string; statusDetail: string | null;
    } | null;
    evm: { provider: string; address: string; explorerUrl: string; network: string } | null;
  };
};
type WireSession = WireMe & { token: string; expiresAt: string };
type WireBalances = {
  treasury: { usdc: string }; agentFloat: { usdc: string }; smartAccount: { usdc: string };
  vault: { id: string | null; underlyingUsdc: string | null; apy: number | null };
  base: { address: string; usdc: string | null } | null;
};
type WirePosition = { vaultId: string; underlyingUsdc: string; apy: number | null; explorerUrl: string };
type WirePolicy = {
  dailyCapUsdc: string; usedInWindowUsdc: string; remainingUsdc: string; periodLedgers: number; transfersInWindow: number;
  policyContract: string; policyExplorerUrl: string; authorised?: boolean;
};
type WireRules = { weeklyCapUsdc: string | null; maxPerCallUsdc: string | null; allowedNetworks: string[]; spentThisWeekUsdc: string; paymentsThisWeek: number };
type WireEvent = { id: string; ts: string; type: string; amountUsdc?: string | null; network?: string | null; txHash?: string | null; explorerUrl?: string | null; detail?: Record<string, unknown> | null };
type WirePay = { url: string; paid: boolean; status: number; body: unknown; network?: string; amountUsdc?: string; txHash?: string; explorerUrl?: string; bridged?: { burnTxHash: string; mintTxHash: string }; timeline: WireEvent[] };
type WireOverCap = { rejected: boolean; attemptedUsdc: string; dailyCapUsdc: string; errorCode: number; errorName: string; explanation: string; policyExplorerUrl: string };

/* ── normalised types (what pages use) ────────────────────────────────── */
export type Me = {
  id: string; displayName: string; email: string | null; status: string; statusDetail: string | null;
  smartAccountId: string | null; smartAccountUrl: string | null;
  treasuryPublicKey: string | null; treasuryUrl: string | null;
  agentPublicKey: string | null; agentUrl: string | null;
  evmAddress: string | null; evmUrl: string | null;
  credentialId: string | null; passkeyPublicKey: string | null;
};
export type Balances = { treasury: number; float: number; smartAccount: number; vault: number; base: number; total: number };
export type Position = { valueUsdc: number; apy: number | null; vaultId: string | null; explorerUrl: string | null };
export type Policy = { capUsdc: number; usedUsdc: number; remainingUsdc: number; windowLedgers: number; transfers: number; policyUrl: string | null };
export const NETWORKS = [
  { id: "stellar:testnet", label: "Stellar", hint: "native x402" },
  { id: "eip155:84532", label: "Base", hint: "via Circle CCTP" },
] as const;
/** Router-enforced rules (the daily cap is separate: on-chain, in `Policy`). null = no limit. */
export type Rules = { weeklyCapUsdc: number | null; maxPerCallUsdc: number | null; allowedNetworks: string[]; spentThisWeekUsdc: number; paymentsThisWeek: number };
export type RulesInput = Pick<Rules, "weeklyCapUsdc" | "maxPerCallUsdc" | "allowedNetworks">;
export type PeraEvent = { id: string; ts: string; type: string; amountUsdc: number | null; network: string | null; txHash: string | null; explorerUrl: string | null; detail: Record<string, unknown> };
export type PayResult = { paid: boolean; status: number; body: unknown; network: string | null; amountUsdc: number | null; txHash: string | null; explorerUrl: string | null; timeline: string[] };
export type DepositDetails = { iban: string; bankName: string | null; reference: string; minTry: number; maxTry: number };
export type PayPrefer = "auto" | "stellar" | "evm";

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
/** 409 SPENDING_CAP_EXCEEDED — the on-chain spending_limit policy said no (#3221). */
export class CapExceededError extends ApiError {}
/** 409 RULE_VIOLATION — a router rule (weekly limit, max per call, allowed chains) refused the payment before signing. */
export class RuleViolationError extends ApiError {}

export interface Backend {
  register(input: { displayName: string; email?: string; dailyCapUsdc?: number }): Promise<string>; // → session token
  login(): Promise<string>;
  logout(): Promise<void>;
  me(): Promise<Me>;
  balances(): Promise<Balances>;
  /** null when the vault is not configured on the API (no DEFINDEX_API_KEY / VAULT_ID). */
  position(): Promise<Position | null>;
  policy(): Promise<Policy>;
  rules(): Promise<Rules>;
  setRules(input: RulesInput): Promise<Rules>;
  events(): Promise<PeraEvent[]>;
  subscribe(onEvent: (e: PeraEvent) => void): () => void;
  /** Deposits are triggered from the CLI; the dashboard only keeps this for the demo backend's seed deposit. */
  onramp(amountTry: number): Promise<void>;
  pay(url: string, prefer?: PayPrefer): Promise<PayResult>;
  overCapDemo(): Promise<string>; // → the chain's rejection, explained
  setCap(capUsdc: number, me: Me): Promise<void>;
  /** The IBAN + reference that route a bank transfer to this user (a fresh reference once the last one is used). */
  depositDetails(): Promise<DepositDetails>;
  /** A separate session for the CLI → the token to paste into `pnpm agent connect`. */
  cliToken(): Promise<string>;
}

/* ── session ──────────────────────────────────────────────────────────── */
const TOKEN_KEY = "pera.session"; // same keys as apps/web, so a session carries over
const CREDENTIAL_KEY = "pera.credentialId";
const DEMO_KEY = "pera.demo";
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: the session just won't persist */
    }
  },
};
export const session = {
  token: () => ls.get(TOKEN_KEY),
  setToken: (t: string | null) => ls.set(TOKEN_KEY, t),
  isDemo: () => ls.get(DEMO_KEY) === "1",
  setDemo: (on: boolean) => ls.set(DEMO_KEY, on ? "1" : null),
  exists: () => Boolean(ls.get(TOKEN_KEY)) || ls.get(DEMO_KEY) === "1",
  /** This browser has registered or signed in before — browsers never reveal whether a passkey exists, so this hint decides what "Continue" does. */
  knowsPasskey: () => Boolean(ls.get(CREDENTIAL_KEY)),
  forgetPasskey: () => ls.set(CREDENTIAL_KEY, null),
};

/* ── helpers ──────────────────────────────────────────────────────────── */
export const usdc = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
/** Decimal string the API's zod schemas accept: up to `digits` decimals, no exponent, no trailing dot. */
const dec = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, "") || "0";

async function http<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const token = session.token();
  if (init.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiError(0, `Can't reach the Pera API at ${API_URL}. Is it running?`);
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body stays as text */
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; code?: string };
    const msg = err.error ?? `${res.status} ${res.statusText}`;
    if (res.status === 401) session.setToken(null); // expired session → the guard sends the user back to onboarding
    if (err.code === "SPENDING_CAP_EXCEEDED") throw new CapExceededError(res.status, msg, err.code);
    if (err.code === "RULE_VIOLATION") throw new RuleViolationError(res.status, msg, err.code);
    throw new ApiError(res.status, msg, err.code ?? null);
  }
  return data as T;
}

/* ── normalisers ──────────────────────────────────────────────────────── */
export function normEvent(e: WireEvent): PeraEvent {
  return {
    id: e.id, ts: e.ts, type: e.type,
    amountUsdc: e.amountUsdc === undefined || e.amountUsdc === null ? null : usdc(e.amountUsdc),
    network: e.network ?? null, txHash: e.txHash ?? null, explorerUrl: e.explorerUrl ?? null, detail: e.detail ?? {},
  };
}
function normMe(m: WireMe): Me {
  const s = m.wallets.stellar;
  const e = m.wallets.evm;
  return {
    id: m.user.id, displayName: m.user.displayName, email: m.user.email,
    status: s?.status ?? "provisioning", statusDetail: s?.statusDetail ?? null,
    smartAccountId: s?.smartAccountId ?? null, smartAccountUrl: s?.smartAccountUrl ?? null,
    treasuryPublicKey: s?.treasury ?? null, treasuryUrl: s?.treasuryUrl ?? null,
    agentPublicKey: s?.agent ?? null, agentUrl: s?.agentUrl ?? null,
    evmAddress: e?.address ?? null, evmUrl: e?.explorerUrl ?? null,
    credentialId: s?.credentialId ?? null, passkeyPublicKey: s?.passkeyPublicKey ?? null,
  };
}
const normRules = (r: WireRules): Rules => ({
  weeklyCapUsdc: r.weeklyCapUsdc === null ? null : usdc(r.weeklyCapUsdc),
  maxPerCallUsdc: r.maxPerCallUsdc === null ? null : usdc(r.maxPerCallUsdc),
  allowedNetworks: r.allowedNetworks,
  spentThisWeekUsdc: usdc(r.spentThisWeekUsdc),
  paymentsThisWeek: r.paymentsThisWeek,
});
const EVENT_TYPES = ["user.registered", "wallet.provisioned", "agent.authorized", "onramp.started", "onramp.completed", "yield.deposited", "yield.withdrawn", "float.topup", "float.topup.rejected", "x402.402", "x402.paid", "x402.rejected", "bridge.burned", "bridge.attested", "bridge.minted", "offramp.completed"];
const timelineLabel = (e: WireEvent) => `${e.type}${e.amountUsdc ? ` · ${e.amountUsdc} USDC` : ""}${e.network?.startsWith("eip155") ? " · Base" : ""}`;

let yieldRetryAt = 0;

/* ── the real backend ─────────────────────────────────────────────────── */
const httpBackend: Backend = {
  // guide §5.1 — one passkey ceremony; POST /auth/register runs ~25–35 s while the wallet is provisioned
  async register({ displayName, email, dailyCapUsdc }) {
    type Options = Parameters<typeof startRegistration>[0]["optionsJSON"];
    const options = await http<Options>("/auth/register/options", { body: { displayName }, auth: false });
    const registration = await startRegistration({ optionsJSON: options });
    const r = await http<WireSession>("/auth/register", {
      body: { displayName, email, challenge: options.challenge, registration, dailyCapUsdc: dailyCapUsdc ? dec(dailyCapUsdc, 7) : undefined },
      auth: false,
    });
    ls.set(CREDENTIAL_KEY, registration.id);
    return r.token;
  },
  // guide §5.2
  async login() {
    const credentialId = ls.get(CREDENTIAL_KEY) ?? undefined;
    const o = await http<{ challenge: string; rpId: string; allowCredentials: { id: string; type: "public-key" }[] }>("/auth/login/options", { body: { credentialId }, auth: false });
    const assertion = await startAuthentication({ optionsJSON: { challenge: o.challenge, rpId: o.rpId, allowCredentials: o.allowCredentials, userVerification: "required", timeout: 60_000 } });
    const r = await http<WireSession>("/auth/login/verify", { body: { challenge: o.challenge, assertion }, auth: false });
    ls.set(CREDENTIAL_KEY, assertion.id);
    return r.token;
  },
  async logout() {
    await http("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
  },
  me: async () => normMe(await http<WireMe>("/me")),
  async balances() {
    const b = await http<WireBalances>("/balances");
    const v = { treasury: usdc(b.treasury.usdc), float: usdc(b.agentFloat.usdc), smartAccount: usdc(b.smartAccount.usdc), vault: usdc(b.vault.underlyingUsdc), base: usdc(b.base?.usdc) };
    return { ...v, total: v.treasury + v.float + v.smartAccount + v.vault + v.base };
  },
  async position() {
    // no vault on this API (no DEFINDEX_API_KEY / VAULT_ID): don't ask again on every poll — it answers 503 and logs an error each time
    if (Date.now() < yieldRetryAt) return null;
    try {
      const p = await http<WirePosition>("/yield/position");
      return { valueUsdc: usdc(p.underlyingUsdc), apy: p.apy, vaultId: p.vaultId, explorerUrl: p.explorerUrl };
    } catch (e) {
      if (e instanceof ApiError && e.code === "YIELD_UNAVAILABLE") {
        yieldRetryAt = Date.now() + 5 * 60_000;
        return null;
      }
      throw e;
    }
  },
  async policy() {
    const p = await http<WirePolicy>("/agent/policy");
    return { capUsdc: usdc(p.dailyCapUsdc), usedUsdc: usdc(p.usedInWindowUsdc), remainingUsdc: usdc(p.remainingUsdc), windowLedgers: p.periodLedgers, transfers: p.transfersInWindow, policyUrl: p.policyExplorerUrl };
  },
  rules: async () => normRules(await http<WireRules>("/agent/rules")),
  async setRules(input) {
    const body = {
      weeklyCapUsdc: input.weeklyCapUsdc === null ? null : dec(input.weeklyCapUsdc, 7),
      maxPerCallUsdc: input.maxPerCallUsdc === null ? null : dec(input.maxPerCallUsdc, 7),
      allowedNetworks: input.allowedNetworks,
    };
    return normRules(await http<WireRules>("/agent/rules", { method: "PUT", body }));
  },
  events: async () => (await http<WireEvent[]>("/events?limit=500")).map(normEvent),
  subscribe(onEvent) {
    const token = session.token();
    if (!token || typeof EventSource === "undefined") return () => undefined;
    const es = new EventSource(`${API_URL}/events/stream?token=${encodeURIComponent(token)}`);
    const handle = (m: MessageEvent) => {
      try {
        onEvent(normEvent(JSON.parse(m.data) as WireEvent));
      } catch {
        /* keep-alive frames */
      }
    };
    // the API names every SSE frame after its event type (sse.ts), so `onmessage` alone would see nothing
    es.onmessage = handle;
    for (const t of EVENT_TYPES) es.addEventListener(t, handle as EventListener);
    return () => es.close();
  },
  onramp: async (amountTry) => void (await http("/onramp", { body: { amountTry: dec(amountTry, 2) } })),
  async pay(url, prefer = "auto") {
    const r = await http<WirePay>("/agent/pay", { body: { url, prefer } });
    const timeline = r.timeline.map(timelineLabel);
    if (r.bridged) timeline.push(`bridged via CCTP · burn ${r.bridged.burnTxHash.slice(0, 8)}… → mint ${r.bridged.mintTxHash.slice(0, 8)}…`);
    return { paid: r.paid, status: r.status, body: r.body, network: r.network ?? null, amountUsdc: r.amountUsdc ? usdc(r.amountUsdc) : null, txHash: r.txHash ?? null, explorerUrl: r.explorerUrl ?? null, timeline };
  },
  async overCapDemo() {
    const r = await http<WireOverCap>("/agent/pay/over-cap-demo", { body: {} });
    return `Error(Contract, #${r.errorCode}) ${r.errorName} — ${r.explanation}`;
  },
  depositDetails: async () => http<DepositDetails>("/onramp/instructions", { body: {} }),
  cliToken: async () => (await http<{ token: string }>("/cli/token", { body: {} })).token,
  // guide §5.7 — build → passkey signs in the browser (kit.signAdmin) → API submits it sponsored
  async setCap(capUsdc, me) {
    if (!me.smartAccountId || !me.credentialId) throw new ApiError(409, "Your wallet is still being set up — try again in a moment.");
    const dailyCapUsdc = dec(capUsdc, 7);
    const build = await http<{ json: string }>("/agent/policy/build", { body: { dailyCapUsdc } });
    const { signExecuteWithPasskey } = await import("./kit"); // heavy (stellar-sdk + kit): only loaded here
    const xdr = await signExecuteWithPasskey({ contractId: me.smartAccountId, credentialId: me.credentialId, publicKeyB64u: me.passkeyPublicKey }, build.json);
    await http("/agent/policy", { body: { xdr, dailyCapUsdc } });
  },
};

/** Every page talks to `api()` — the real API, or the clearly-labelled in-browser demo backend. */
export const api = (): Backend => (session.isDemo() ? demoBackend : httpBackend);
