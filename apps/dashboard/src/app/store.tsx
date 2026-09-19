import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Balances, type Me, type PeraEvent, type Policy, type Position } from "./api";

/** Everything the dashboard pages read. Loaded once, refreshed on every SSE event and on a slow poll. */
type AppData = {
  me: Me | null;
  balances: Balances | null;
  position: Position | null;
  /** vault value − net deposits, derived from the event log */
  earnedUsdc: number;
  policy: Policy | null;
  events: PeraEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Subscribe to live events (used by the flow scene to animate payments as they settle). */
  onLive: (fn: (e: PeraEvent) => void) => () => void;
};

const Ctx = createContext<AppData | null>(null);
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <AppDataProvider>");
  return v;
};

const POLL_MS = 12_000;

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [events, setEvents] = useState<PeraEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(new Set<(e: PeraEvent) => void>());

  const refresh = useCallback(async () => {
    const b = api();
    // each call settles on its own: a missing vault (no DEFINDEX key) must not blank the whole page
    const [m, bal, pos, pol, ev] = await Promise.allSettled([b.me(), b.balances(), b.position(), b.policy(), b.events()]);
    if (m.status === "fulfilled") setMe(m.value);
    if (bal.status === "fulfilled") setBalances(bal.value);
    if (pos.status === "fulfilled") setPosition(pos.value);
    if (pol.status === "fulfilled") setPolicy(pol.value);
    if (ev.status === "fulfilled") setEvents([...ev.value].sort((a, z) => z.ts.localeCompare(a.ts)));
    const failed = [m, bal].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? String((failed.reason as Error)?.message ?? failed.reason) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const stop = api().subscribe((e) => {
      setEvents((cur) => (cur.some((x) => x.id === e.id) ? cur : [e, ...cur]));
      live.current.forEach((fn) => fn(e));
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 500);
    });
    return () => {
      clearInterval(poll);
      clearTimeout(debounce);
      stop();
    };
  }, [refresh]);

  const onLive = useCallback((fn: (e: PeraEvent) => void) => {
    live.current.add(fn);
    return () => void live.current.delete(fn);
  }, []);

  // The API reports the vault's value and APY, not earnings → earned = value − (deposited − withdrawn), from the event log.
  const earnedUsdc = useMemo(() => {
    if (!position) return 0;
    const net = events.reduce((a, e) => a + (e.type === "yield.deposited" ? (e.amountUsdc ?? 0) : e.type === "yield.withdrawn" ? -(e.amountUsdc ?? 0) : 0), 0);
    return Math.max(0, position.valueUsdc - Math.max(0, net));
  }, [position, events]);

  const value = useMemo(() => ({ me, balances, position, earnedUsdc, policy, events, loading, error, refresh, onLive }), [me, balances, position, earnedUsdc, policy, events, loading, error, refresh, onLive]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ── event presentation helpers shared by Home / Analytics ─────────────── */
export type EventKind = "deposit" | "yield" | "agent" | "bridge" | "withdraw" | "account";
export function describe(e: PeraEvent): { kind: EventKind; label: string; sign: "+" | "−" | ""; rejected?: boolean } {
  const url = typeof e.detail.url === "string" ? e.detail.url : null;
  const where = url ? ` · ${shortUrl(url)}` : "";
  switch (e.type) {
    case "onramp.started": return { kind: "deposit", label: "Lira deposit started", sign: "" };
    case "onramp.completed": return { kind: "deposit", label: "Lira arrived as USDC", sign: "+" };
    case "yield.deposited": return { kind: "yield", label: "Moved into the vault", sign: "" };
    case "yield.withdrawn": return { kind: "yield", label: "Pulled from the vault", sign: "" };
    case "float.topup": return { kind: "agent", label: "Agent budget topped up", sign: "" };
    case "float.topup.rejected": return { kind: "agent", label: "Top-up rejected by the on-chain cap", sign: "", rejected: true };
    case "x402.402": return { kind: "agent", label: `Paywall quoted a price${where}`, sign: "" };
    case "x402.paid": return { kind: "agent", label: `Agent paid${where}`, sign: "−" };
    case "bridge.burned": return { kind: "bridge", label: "USDC burned on Stellar (CCTP)", sign: "" };
    case "bridge.attested": return { kind: "bridge", label: "Circle attested the burn", sign: "" };
    case "bridge.minted": return { kind: "bridge", label: "USDC minted on Base", sign: "" };
    case "offramp.completed": return { kind: "withdraw", label: "Withdrawn to your bank", sign: "−" };
    case "user.registered": return { kind: "account", label: "Account created", sign: "" };
    case "wallet.provisioned": return { kind: "account", label: "Smart account deployed", sign: "" };
    case "agent.authorized": return { kind: "account", label: "Agent rule set on-chain", sign: "" };
    default: return { kind: "account", label: e.type, sign: "" };
  }
}
export function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/api\//, "/").replace(/\/$/, "") || u.host;
  } catch {
    return url;
  }
}
/** Things that started but have not finished: a deposit without its completion, a burn without its mint. */
export function pendingOf(events: PeraEvent[]): PeraEvent[] {
  const asc = [...events].sort((a, z) => a.ts.localeCompare(z.ts));
  const open: PeraEvent[] = [];
  const close = (type: string) => {
    const i = open.findIndex((o) => o.type === type);
    if (i >= 0) open.splice(i, 1);
  };
  for (const e of asc) {
    if (e.type === "onramp.started" || e.type === "bridge.burned") open.push(e);
    else if (e.type === "onramp.completed") close("onramp.started");
    else if (e.type === "bridge.minted") close("bridge.burned");
  }
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  return open.filter((e) => Date.parse(e.ts) > dayAgo).reverse();
}
export const usd = (n: number, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
