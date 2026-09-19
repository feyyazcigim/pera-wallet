import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FlowScene, type FlowSceneHandle, type FlowStep } from "../FlowScene";
import { api, CapExceededError, RESOURCE_SERVER_URL, type PayPrefer, type PayResult, type PeraEvent } from "./api";
import { describe, pendingOf, shortUrl, timeAgo, usd, useApp, type EventKind } from "./store";

const FILTERS: { key: "all" | EventKind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "deposit", label: "Deposits" },
  { key: "yield", label: "Vault" },
  { key: "agent", label: "Agent" },
  { key: "bridge", label: "Bridge" },
  { key: "withdraw", label: "Withdrawals" },
];

export function Home() {
  const { me, balances, position, earnedUsdc, policy, events, loading } = useApp();
  const [modal, setModal] = useState<null | "add" | "withdraw">(null);
  const pending = useMemo(() => pendingOf(events), [events]);
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {hello}, {me?.displayName ?? "…"}
          </h1>
          <p className="muted">Your money is earning, and your agent is on a leash.</p>
        </div>
        <div className="actions">
          <button className="btn-line" type="button" onClick={() => setModal("withdraw")}>
            Withdraw
          </button>
          <button className="btn-solid" type="button" onClick={() => setModal("add")}>
            Add lira
          </button>
        </div>
      </header>

      <section className="tiles">
        <Tile label="Total balance" value={balances ? usd(balances.total) : "—"} loading={loading} big>
          {balances && (
            <small>
              vault {usd(balances.vault)} · liquid {usd(balances.treasury + balances.smartAccount)} · agent {usd(balances.float + balances.base)}
            </small>
          )}
        </Tile>
        <Tile label="Yield earned" value={position ? `+${usd(earnedUsdc, 6)}` : "—"} loading={loading} mark={Boolean(position)}>
          <small>{position ? `${usd(position.valueUsdc)} in the vault${position.apy !== null ? ` · ${(position.apy * (position.apy > 1 ? 1 : 100)).toFixed(2)}% APY` : ""}` : "vault not configured on the API"}</small>
        </Tile>
        <Tile label="Agent budget drawn today" value={policy ? usd(policy.usedUsdc, 3) : "—"} loading={loading}>
          {policy && (
            <>
              <div className="meter" role="img" aria-label={`${usd(policy.usedUsdc, 2)} of ${usd(policy.capUsdc)} used`}>
                <i style={{ width: `${Math.min(100, (policy.usedUsdc / Math.max(policy.capUsdc, 0.0001)) * 100)}%` }} />
              </div>
              <small>
                {usd(policy.remainingUsdc)} left of a {usd(policy.capUsdc)} daily cap
              </small>
            </>
          )}
        </Tile>
        <Tile label="Pending" value={String(pending.length)} loading={loading}>
          <small>{pending.length ? "in flight right now" : "nothing in flight"}</small>
        </Tile>
      </section>

      <LiveFlow />

      <section className="cols">
        <Panel title="Pending transactions">
          {pending.length === 0 ? (
            <p className="empty">Nothing in flight. Deposits and bridge transfers show up here while they settle.</p>
          ) : (
            <ul className="pending">
              {pending.map((e) => (
                <li key={e.id}>
                  <span className="spinner" />
                  <div>
                    <b>{e.type === "onramp.started" ? `Lira deposit${tryOf(e) ? ` · ₺${tryOf(e)!.toLocaleString("en-US")}` : ""}` : "Bridge to Base"}</b>
                    <small>{e.type === "onramp.started" ? "waiting for the anchor to pay out USDC" : "waiting for Circle's attestation"}</small>
                  </div>
                  <time>{timeAgo(e.ts)}</time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <AgentConsole />
      </section>

      <History events={events} />

      <AnimatePresence>{modal && <MoneyModal kind={modal} onClose={() => setModal(null)} />}</AnimatePresence>
    </>
  );
}

/** `detail.amountTry` is a decimal string on the wire. */
const tryOf = (e: PeraEvent): number | null => {
  const n = Number.parseFloat(String(e.detail.amountTry ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function Tile(p: { label: string; value: string; loading: boolean; big?: boolean; mark?: boolean; children?: ReactNode }) {
  return (
    <div className={`tile${p.big ? " big" : ""}`}>
      <span className="tile-label">{p.label}</span>
      <strong className={p.loading ? "skeleton" : ""}>{p.mark && !p.loading ? <mark>{p.value}</mark> : p.value}</strong>
      {p.children}
    </div>
  );
}
function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The landing page's flow scene, driven by real events: a deposit walks it, every settled payment fires a coin. */
function LiveFlow() {
  const { events, balances, position, earnedUsdc, policy, onLive } = useApp();
  const ref = useRef<FlowSceneHandle>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const settled = useMemo(() => {
    if (events.some((e) => e.type === "yield.deposited" || e.type === "x402.paid")) return 4;
    if (events.some((e) => e.type === "onramp.completed")) return 3;
    return 0;
  }, [events]);
  const [step, setStep] = useState<FlowStep>(settled as FlowStep);
  const playing = useRef(false);
  useEffect(() => {
    if (!playing.current) setStep(settled as FlowStep);
  }, [settled]);

  const paid = useMemo(() => events.filter((e) => e.type === "x402.paid"), [events]);
  const services = useMemo(() => {
    const names: string[] = [];
    for (const e of paid) {
      const n = typeof e.detail.url === "string" ? shortUrl(e.detail.url) : null;
      if (n && !names.includes(n)) names.push(n);
      if (names.length === 3) break;
    }
    return names.length ? [...names, "paywall", "paywall"].slice(0, 3) : ["weather", "paywall", "paywall"];
  }, [paid]);
  const servicesRef = useRef(services);
  servicesRef.current = services;

  useEffect(() => {
    const at = (ms: number, s: FlowStep, done = false) =>
      timers.current.push(
        setTimeout(() => {
          setStep(s);
          if (done) playing.current = false;
        }, ms),
      );
    const stop = onLive((e: PeraEvent) => {
      if (e.type === "onramp.started") {
        playing.current = true;
        setStep(0);
        at(900, 1);
      } else if (e.type === "onramp.completed") {
        playing.current = true;
        setStep(2);
        at(1300, 3, true);
      } else if (e.type === "yield.deposited") {
        at(1400, 4, true);
      } else if (e.type === "x402.paid") {
        setStep(4);
        const name = typeof e.detail.url === "string" ? shortUrl(e.detail.url) : "";
        const i = servicesRef.current.indexOf(name);
        ref.current?.pay(i >= 0 ? i : 0);
      }
    });
    return () => {
      stop();
      timers.current.forEach(clearTimeout);
    };
  }, [onLive]);

  const lastDeposit = events.find((e) => e.type === "onramp.completed");
  const tryAmt = lastDeposit ? tryOf(lastDeposit) : null;
  return (
    <section className="panel flow-panel">
      <header>
        <h2>Live flow</h2>
        <span className="chip live">
          <i /> updates as it happens
        </span>
      </header>
      <FlowScene
        ref={ref}
        step={step}
        command="pera onramp"
        live={{
          quote: lastDeposit && tryAmt ? `₺${tryAmt.toLocaleString("en-US")} → ${usd(lastDeposit.amountUsdc ?? 0)}` : "TRY → USDC",
          quoteSub: lastDeposit && tryAmt && lastDeposit.amountUsdc ? `quote locked @ ${(tryAmt / lastDeposit.amountUsdc).toFixed(2)}` : "quote locked by the anchor",
          staked: position?.valueUsdc ?? balances?.vault ?? 0,
          earned: earnedUsdc,
          spent: policy?.usedUsdc ?? 0,
          calls: paid.filter((e) => Date.now() - Date.parse(e.ts) < 24 * 3600 * 1000).length,
          cap: policy?.capUsdc,
          services,
        }}
      />
    </section>
  );
}

// the three demo paywalls of apps/resource-server
const PRESETS: { label: string; url: string; prefer: PayPrefer }[] = [
  { label: "weather · Stellar", url: `${RESOURCE_SERVER_URL}/api/stellar/weather`, prefer: "auto" },
  { label: "summary · Base via CCTP", url: `${RESOURCE_SERVER_URL}/api/base/summary`, prefer: "evm" },
  { label: "quote · either network", url: `${RESOURCE_SERVER_URL}/api/any/quote`, prefer: "auto" },
];

function AgentConsole() {
  const { refresh } = useApp();
  const [url, setUrl] = useState(PRESETS[0].url);
  const [prefer, setPrefer] = useState<PayPrefer>("auto");
  const [busy, setBusy] = useState<null | "pay" | "cap">(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<{ text: string; cap: boolean } | null>(null);

  async function pay(e: FormEvent) {
    e.preventDefault();
    setBusy("pay");
    setError(null);
    setResult(null);
    try {
      setResult(await api().pay(url.trim(), prefer));
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : String(err), cap: err instanceof CapExceededError });
    } finally {
      setBusy(null);
      void refresh();
    }
  }
  async function overCap() {
    setBusy("cap");
    setError(null);
    setResult(null);
    try {
      setError({ text: await api().overCapDemo(), cap: true });
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : String(err), cap: false });
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  return (
    <Panel title="Agent console" aside={<span className="muted small">send your agent to a paywall</span>}>
      <form className="console" onSubmit={pay}>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPrefer("auto");
          }}
          placeholder="https://…"
          spellCheck={false}
          aria-label="Paywalled URL"
        />
        <button className="btn-solid" type="submit" disabled={busy !== null || !url.trim()}>
          {busy === "pay" ? "Paying…" : "Pay"}
        </button>
      </form>
      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.url}
            type="button"
            className={`chip${url === p.url ? " on" : ""}`}
            onClick={() => {
              setUrl(p.url);
              setPrefer(p.prefer);
            }}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="chip" disabled={busy !== null} onClick={() => void overCap()}>
          {busy === "cap" ? "asking the chain…" : "try to overspend →"}
        </button>
      </div>
      {result && (
        <div className="console-out ok">
          <ol>
            {result.timeline.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
          <p className="console-meta mono">
            {result.paid ? "paid" : `not paid · HTTP ${result.status}`}
            {result.amountUsdc !== null && ` · ${usd(result.amountUsdc, 3)}`}
            {result.network && ` · ${result.network.startsWith("eip155") ? "Base Sepolia" : "Stellar"}`}
            {result.explorerUrl && (
              <>
                {" · "}
                <a href={result.explorerUrl} target="_blank" rel="noreferrer">
                  transaction ↗
                </a>
              </>
            )}
          </p>
          <pre>{typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)}</pre>
        </div>
      )}
      {error && (
        <div className={`console-out ${error.cap ? "cap" : "err"}`}>
          {error.cap && <b>The contract said no.</b>}
          <p>{error.text}</p>
        </div>
      )}
    </Panel>
  );
}

function History({ events }: { events: PeraEvent[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [limit, setLimit] = useState(12);
  const rows = useMemo(() => events.map((e) => ({ e, d: describe(e) })).filter((r) => r.e.type !== "x402.402" && (filter === "all" || r.d.kind === filter)), [events, filter]);
  return (
    <Panel
      title="History"
      aside={
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`chip${filter === f.key ? " on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="empty">No activity yet. Add lira to get things moving.</p>
      ) : (
        <table className="history">
          <thead>
            <tr>
              <th>What happened</th>
              <th>Network</th>
              <th className="num">Amount</th>
              <th>When</th>
              <th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(({ e, d }) => (
              <tr key={e.id} className={d.rejected ? "rejected" : ""}>
                <td>
                  <i className={`dot ${d.kind}`} />
                  {d.label}
                </td>
                <td className="mono">{e.network?.startsWith("eip155") ? "Base Sepolia" : e.network ? "Stellar" : "—"}</td>
                <td className="num mono">{e.amountUsdc === null ? "—" : `${d.sign}${usd(e.amountUsdc, e.amountUsdc < 1 ? 3 : 2)}`}</td>
                <td>
                  <time title={new Date(e.ts).toLocaleString()}>{timeAgo(e.ts)}</time>
                </td>
                <td className="mono">
                  {e.explorerUrl ? (
                    <a href={e.explorerUrl} target="_blank" rel="noreferrer">
                      {e.txHash ? `${e.txHash.slice(0, 6)}…` : "view"} ↗
                    </a>
                  ) : e.txHash ? (
                    `${e.txHash.slice(0, 6)}…`
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > limit && (
        <button type="button" className="more" onClick={() => setLimit((l) => l + 20)}>
          Show more ({rows.length - limit})
        </button>
      )}
    </Panel>
  );
}

function MoneyModal({ kind, onClose }: { kind: "add" | "withdraw"; onClose: () => void }) {
  const { balances, refresh } = useApp();
  const [amount, setAmount] = useState(kind === "add" ? "3000" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number.parseFloat(amount);
  const available = balances ? balances.treasury + balances.vault : 0;
  const valid = kind === "add" ? n >= 50 && n <= 3000 : n > 0 && n <= available + 1e-9;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (kind === "add") await api().onramp(n);
      else await api().offramp(n);
      void refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form className="modal" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{kind === "add" ? "Add lira" : "Withdraw to your bank"}</h2>
        <p className="muted">
          {kind === "add"
            ? "A bank transfer through the anchor. On testnet the bank is simulated: the lira \"arrives\" as soon as you confirm, then it becomes USDC and moves into the vault."
            : `USDC leaves the vault, goes back through the anchor and lands in your bank as lira. Available: ${usd(available)}.`}
        </p>
        <label>
          {kind === "add" ? "Amount in TRY (50 – 3,000)" : "Amount in USDC"}
          <div className="amount">
            <span>{kind === "add" ? "₺" : "$"}</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} autoFocus />
          </div>
        </label>
        {error && <p className="onb-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-line" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-solid" disabled={!valid || busy}>
            {busy ? "Working…" : kind === "add" ? "Send lira" : "Withdraw"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
