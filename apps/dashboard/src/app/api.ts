/**
 * Pera API client — typed against apps/api (routes/*.ts, schemas.ts) and openapi.yaml.
 * All USDC / TRY amounts cross the wire as decimal STRINGS; pages only see the normalised number types below.
 */
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { demoBackend } from "./demo";

// Deploy convention: dashboard on <domain>, API on api.<domain> — so VITE_API_URL is optional in production.
const isLocal = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
// `||` not `??`: an empty VITE_API_URL (Docker ARG not passed) must fall through to the default, otherwise every
// request goes to the dashboard's own origin and nginx answers 405 for POST.
const trimSlash = (u: string) => u.replace(/\/+$/, "");
export const API_URL: string = trimSlash(
  import.meta.env.VITE_API_URL || (isLocal ? "http://localhost:3000" : `https://api.${window.location.hostname}`),
);
export const RESOURCE_SERVER_URL: string = trimSlash(import.meta.env.VITE_RESOURCE_SERVER_URL || "http://localhost:4000");

/* ── wire types (what the API returns) ────────────────────────────────── */
type WireMe = {
  user: { id: string; displayName: string; email: string | null; createdAt: string };
  wallets: {
    stellar: {
      smartAccountId: string; smartAccountUrl: string; credentialId: string; passkeyPublicKey: string | null;
      treasury: string; treasuryUrl: string; agent: string; agentUrl: string;
      agentRuleId: number | null; agentAuthorised: boolean; dailyCapUsdc: string; status: string; statusDetail: string | null;
      sweepRuleId?: number | null; autoSweep?: boolean;
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
  weekly?: { capUsdc: string; usedInWindowUsdc: string; remainingUsdc: string; transfersInWindow: number; policyExplorerUrl: string } | null;
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
  /** the treasury-sweep rule is on the smart account: USDC sent to it moves to the treasury/vault by itself */
  autoSweep: boolean;
};
export type Balances = { treasury: number; float: number; smartAccount: number; vault: number; base: number; total: number };
export type Position = { valueUsdc: number; apy: number | null; vaultId: string | null; explorerUrl: string | null };
/** One on-chain spending window. */
export type CapWindow = { capUsdc: number; usedUsdc: number; remainingUsdc: number; transfers: number; policyUrl: string | null };
/** The daily window, plus the weekly one when the agent's rule carries it (null on rules created before it existed). */
export type Policy = CapWindow & { windowLedgers: number; weekly: CapWindow | null };
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
  /**
   * The first half of the single Continue button: if a passkey for us already lives on this device, sign in with it
   * and return the session token. `null` means there is none here, so this is a new person: ask their name, then `register`.
   */
  signInIfKnown(): Promise<string | null>;
  login(): Promise<string>;
  logout(): Promise<void>;
  me(): Promise<Me>;
  balances(): Promise<Balances>;
  /** null when the vault is not configured on the API (no DEFINDEX_API_KEY / VAULT_ID). */
  position(): Promise<Position | null>;
  policy(): Promise<Policy>;
  rules(): Promise<Rules>;
  /** Router rules alone: one passkey prompt approves the new ruleset. */
  setRules(input: RulesInput): Promise<Rules>;
  events(): Promise<PeraEvent[]>;
  subscribe(onEvent: (e: PeraEvent) => void): () => void;
  /** Deposits are triggered from the CLI; the dashboard only keeps this for the demo backend's seed deposit. */
  onramp(amountTry: number): Promise<void>;
  pay(url: string, prefer?: PayPrefer): Promise<PayResult>;
  overCapDemo(): Promise<string>; // → the chain's rejection, explained
  /** Daily cap (on-chain). Pass `rules` to change the router rules under the same single passkey prompt. */
  /** A contract change, signed by the passkey. `window` picks the policy: the daily one or the weekly one. */
  setCap(capUsdc: number, me: Me, rules?: RulesInput, window?: "daily" | "weekly"): Promise<void>;
  /** One passkey prompt: adds the treasury-sweep rule to an account created before auto-sweep existed. */
  enableAutoSweep(me: Me): Promise<void>;
  /** The IBAN + reference that route a bank transfer to this user (a fresh reference once the last one is used). */
  depositDetails(): Promise<DepositDetails>;
  /** A separate session for the CLI → the token to paste into `pnpm agent connect`. */
  cliToken(): Promise<string>;
  /** Scoped, revocable keys for external agents (Hermes, Claude Code, …); the secret is only returned by createAgentKey. */
  agentKeys(): Promise<AgentKey[]>;
  createAgentKey(input: { name: string; scopes: AgentScope[] }): Promise<{ key: AgentKey; secret: string }>;
  revokeAgentKey(id: string): Promise<void>;
}

/* ── agent keys ───────────────────────────────────────────────────────── */
export type AgentScope = "read" | "pay";
export const SCOPES: { id: AgentScope; label: string; hint: string }[] = [
  { id: "read", label: "read", hint: "balances, policy, quotes, history" },
  { id: "pay", label: "pay", hint: "pay x402 paywalls under your rules" },
];
export type AgentKey = { id: string; name: string; scopes: AgentScope[]; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null };
/** What an MCP client needs — mirrors apps/api/src/mcp/hermes.ts, computed here so the secret never round-trips. */
export function connectKit(secret: string) {
  const mcpUrl = `${API_URL}/mcp`;
  const snippetYaml = [
    "mcp_servers:",
    "  pera_wallet:",
    `    url: "${mcpUrl}"`,
    "    headers:",
    '      Authorization: "Bearer ${PERA_AGENT_TOKEN}"',
    "    timeout: 300",
    "    connect_timeout: 30",
  ].join("\n");
  return { mcpUrl, envLine: `PERA_AGENT_TOKEN=${secret}`, snippetYaml, claudeCode: ["claude mcp add --transport http pera \\", `  ${mcpUrl} \\`, `  --header "Authorization: Bearer ${secret}"`].join("\n") };
}

/* ── session ──────────────────────────────────────────────────────────── */
const TOKEN_KEY = "pera.session"; // same keys as apps/web, so a session carries over
const CREDENTIAL_KEY = "pera.credentialId";
const DEMO_KEY = "pera.demo";
const NAME_KEY = "pera.name";
const FUNDED_KEY = "pera.funded";
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
  setToken: (t: string | null) => {
    ls.set(TOKEN_KEY, t);
    if (t === null) {
      ls.set(NAME_KEY, null);
      ls.set(FUNDED_KEY, null);
    }
  },
  /** The owner's name from the last visit, so the greeting is right on first paint instead of changing when /me lands. */
  name: () => ls.get(NAME_KEY),
  setName: (n: string | null) => ls.set(NAME_KEY, n),
  /** Same idea for the headline's last word: whether the wallet held money last time. */
  funded: () => ls.get(FUNDED_KEY) === "1",
  setFunded: (on: boolean) => ls.set(FUNDED_KEY, on ? "1" : "0"),
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
    autoSweep: s?.autoSweep ?? false,
  };
}
const normRules = (r: WireRules): Rules => ({
  weeklyCapUsdc: r.weeklyCapUsdc === null ? null : usdc(r.weeklyCapUsdc),
  maxPerCallUsdc: r.maxPerCallUsdc === null ? null : usdc(r.maxPerCallUsdc),
  allowedNetworks: r.allowedNetworks,
  spentThisWeekUsdc: usdc(r.spentThisWeekUsdc),
  paymentsThisWeek: r.paymentsThisWeek,
});
const wireRules = (input: RulesInput) => ({
  weeklyCapUsdc: input.weeklyCapUsdc === null ? null : dec(input.weeklyCapUsdc, 7),
  maxPerCallUsdc: input.maxPerCallUsdc === null ? null : dec(input.maxPerCallUsdc, 7),
  allowedNetworks: input.allowedNetworks,
});
const EVENT_TYPES = ["user.registered", "wallet.provisioned", "agent.authorized", "onramp.started", "onramp.completed", "yield.deposited", "yield.withdrawn", "float.topup", "float.topup.rejected", "treasury.swept", "x402.402", "x402.paid", "x402.rejected", "bridge.burned", "bridge.attested", "bridge.minted", "offramp.completed"];
const timelineLabel = (e: WireEvent) => `${e.type}${e.amountUsdc ? ` · ${e.amountUsdc} USDC` : ""}${e.network?.startsWith("eip155") ? " · Base" : ""}`;

let yieldRetryAt = 0;

/** Sign-in already tells us who this is: keep the name so the dashboard's first paint greets them by it. */
function rememberOwner(r: WireSession) {
  if (r.user?.displayName) ls.set(NAME_KEY, r.user.displayName);
}

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
    rememberOwner(r);
    return r.token;
  },
  // guide §5.2
  async login() {
    const credentialId = ls.get(CREDENTIAL_KEY) ?? undefined;
    const o = await http<{ challenge: string; rpId: string; allowCredentials: { id: string; type: "public-key" }[] }>("/auth/login/options", { body: { credentialId }, auth: false });
    const assertion = await startAuthentication({ optionsJSON: { challenge: o.challenge, rpId: o.rpId, allowCredentials: o.allowCredentials, userVerification: "required", timeout: 60_000 } });
    const r = await http<WireSession>("/auth/login/verify", { body: { challenge: o.challenge, assertion }, auth: false });
    ls.set(CREDENTIAL_KEY, assertion.id);
    rememberOwner(r);
    return r.token;
  },
  /**
   * Browsers never say whether a passkey exists, but "immediate mediation" comes close: `get()` fails at once,
   * with no dialog, when this device holds no passkey for us, and shows the usual picker when it does.
   * So: try that first; nothing there means a new person. Browsers without it fall back to the hint this
   * browser keeps from its last visit.
   */
  async signInIfKnown() {
    type Caps = { immediateGet?: boolean };
    type PKC = typeof PublicKeyCredential & { getClientCapabilities?: () => Promise<Caps>; parseRequestOptionsFromJSON?: (o: unknown) => PublicKeyCredentialRequestOptions };
    const pkc = typeof PublicKeyCredential === "undefined" ? undefined : (PublicKeyCredential as PKC);
    const caps = await pkc?.getClientCapabilities?.().catch(() => null);
    const unknownHere = (e: unknown) => e instanceof ApiError && (e.code === "UNKNOWN_CREDENTIAL" || e.code === "UNKNOWN_USER");
    if (caps?.immediateGet && pkc?.parseRequestOptionsFromJSON) {
      const o = await http<{ challenge: string; rpId: string }>("/auth/login/options", { body: {}, auth: false });
      const asked = performance.now();
      try {
        const publicKey = pkc.parseRequestOptionsFromJSON({ challenge: o.challenge, rpId: o.rpId, allowCredentials: [], userVerification: "required", timeout: 60_000 });
        // `uiMode: "immediate"` is the shipped spelling (Chrome); it is not in TypeScript's DOM types yet
        const cred = (await navigator.credentials.get({ uiMode: "immediate", publicKey } as CredentialRequestOptions)) as (PublicKeyCredential & { toJSON(): { id: string } }) | null;
        if (cred) {
          const assertion = cred.toJSON();
          const r = await http<WireSession>("/auth/login/verify", { body: { challenge: o.challenge, assertion }, auth: false });
          ls.set(CREDENTIAL_KEY, assertion.id);
          rememberOwner(r);
          return r.token;
        }
      } catch (e) {
        const dismissed = (e as Error)?.name === "NotAllowedError" && performance.now() - asked > 1200; // an instant refusal means "no passkey here"; a slow one means the person closed the picker
        if (!unknownHere(e) && ((e as Error)?.name !== "NotAllowedError" || dismissed)) throw e;
      }
    } else if (session.knowsPasskey()) {
      try {
        return await this.login();
      } catch (e) {
        if (!unknownHere(e)) throw e;
        session.forgetPasskey(); // stale hint (other server, wiped database): this is a new wallet after all
      }
    }
    return null;
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
    const weekly = p.weekly ? { capUsdc: usdc(p.weekly.capUsdc), usedUsdc: usdc(p.weekly.usedInWindowUsdc), remainingUsdc: usdc(p.weekly.remainingUsdc), transfers: p.weekly.transfersInWindow, policyUrl: p.weekly.policyExplorerUrl } : null;
    return { capUsdc: usdc(p.dailyCapUsdc), usedUsdc: usdc(p.usedInWindowUsdc), remainingUsdc: usdc(p.remainingUsdc), windowLedgers: p.periodLedgers, transfers: p.transfersInWindow, policyUrl: p.policyExplorerUrl, weekly };
  },
  rules: async () => normRules(await http<WireRules>("/agent/rules")),
  async setRules(input) {
    const o = await http<{ challenge: string; rpId: string; allowCredentials: { id: string; type: "public-key" }[] }>("/agent/rules/options", { body: wireRules(input) });
    const assertion = await startAuthentication({ optionsJSON: { challenge: o.challenge, rpId: o.rpId, allowCredentials: o.allowCredentials, userVerification: "required", timeout: 60_000 } });
    return normRules(await http<WireRules>("/agent/rules", { method: "PUT", body: { challenge: o.challenge, assertion } }));
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
    return `Error(Contract, #${r.errorCode}) ${r.errorName}: ${r.explanation}`;
  },
  depositDetails: async () => http<DepositDetails>("/onramp/instructions", { body: {} }),
  cliToken: async () => (await http<{ token: string }>("/cli/token", { body: {} })).token,
  agentKeys: async () => http<AgentKey[]>("/agent/tokens"),
  async createAgentKey(input) {
    const r = await http<AgentKey & { token: string }>("/agent/tokens", { body: { name: input.name, scopes: input.scopes } });
    const { token, ...key } = r;
    return { key: { ...key, createdAt: key.createdAt ?? new Date().toISOString(), lastUsedAt: null, revokedAt: null }, secret: token };
  },
  revokeAgentKey: async (id) => void (await http(`/agent/tokens/${encodeURIComponent(id)}`, { method: "DELETE" })),
  // guide §5.7 — build → passkey signs in the browser (kit.signAdmin) → API submits it sponsored
  async setCap(capUsdc, me, rules, window = "daily") {
    if (!me.smartAccountId || !me.credentialId) throw new ApiError(409, "Your wallet is still being set up. Try again in a moment.");
    const cap = window === "weekly" ? { weeklyCapUsdc: dec(capUsdc, 7) } : { dailyCapUsdc: dec(capUsdc, 7) };
    const build = await http<{ json: string; method: "set_spending_limit" | "add_policy" }>("/agent/policy/build", { body: cap });
    const { signWithPasskey } = await import("./kit"); // heavy (stellar-sdk + kit): only loaded here
    const xdr = await signWithPasskey({ contractId: me.smartAccountId, credentialId: me.credentialId, publicKeyB64u: me.passkeyPublicKey }, build.json, build.method === "add_policy" ? "add_policy" : "execute");
    await http("/agent/policy", { body: { xdr, ...cap, rules: rules ? wireRules(rules) : undefined } });
  },
  async enableAutoSweep(me) {
    if (!me.smartAccountId || !me.credentialId) throw new ApiError(409, "Your wallet is still being set up — try again in a moment.");
    const build = await http<{ json: string }>("/agent/sweep/build", { body: {} });
    const { signWithPasskey } = await import("./kit");
    const xdr = await signWithPasskey({ contractId: me.smartAccountId, credentialId: me.credentialId, publicKeyB64u: me.passkeyPublicKey }, build.json, "add_context_rule");
    await http("/agent/sweep", { body: { xdr } });
  },
};

/** Every page talks to `api()` — the real API, or the clearly-labelled in-browser demo backend. */
export const api = (): Backend => (session.isDemo() ? demoBackend : httpBackend);
