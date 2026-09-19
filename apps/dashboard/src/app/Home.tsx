import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { MagnetTabs } from "@/components/block/magnet-tabs";
import { FlowScene, type FlowSceneHandle, type FlowStep } from "../FlowScene";
import { CountUp, Hl, Line, Rise } from "../ui";
import { api, CapExceededError, NETWORKS, RESOURCE_SERVER_URL, RuleViolationError, type PayPrefer, type PayResult, type PeraEvent } from "./api";
import { describe, pendingOf, shortUrl, timeAgo, usd, useApp, type EventKind } from "./store";

const FILTERS: Record<string, "all" | EventKind> = { All: "all", Deposits: "deposit", Vault: "yield", Agent: "agent", Bridge: "bridge" };
const BTN = { bgColor: "#ffd400", textColor: "#0a0a0a", fillBgColor: "#0a0a0a", fillTextColor: "#ffd400", hoverFillBgColor: "#0a0a0a", hoverFillTextColor: "#ffd400" };

/** Short paywall name for the flow scene's small service boxes: the last path segment ("weather"). */
const svcName = (url: unknown): string | null => (typeof url === "string" ? (shortUrl(url).split("/").filter(Boolean).pop() ?? null) : null);

/** `detail.amountTry` is a decimal string on the wire. */
const tryOf = (e: PeraEvent): number | null => {
  const n = Number.parseFloat(String(e.detail.amountTry ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function Home() {
  const { me, balances, position, earnedUsdc, policy, events, loading } = useApp();
  const pending = useMemo(() => pendingOf(events), [events]);
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = me?.displayName.split(" ")[0] ?? "";
  const idle = !loading && (balances?.total ?? 0) === 0;

  return (
    <>
      <section className="dash-hero">
        <h1>
          <Line delay={0.05}>
            {hello}
            {first && `, ${first}`}. Your lira is <Hl delay={0.7}>{idle ? "on its way" : "earning"}</Hl>.
          </Line>
        </h1>

        <Rise className="hero-figure" delay={0.35}>
          <div className="hero-total">
            <small>Total balance</small>
            <strong className={loading ? "skeleton" : ""}>{balances ? <CountUp value={balances.total} format={(n) => usd(n)} /> : "—"}</strong>
          </div>
          <dl className="hero-facts">
            <div>
              <dt>Working in the vault</dt>
              <dd>{position ? <CountUp value={position.valueUsdc} format={(n) => usd(n)} /> : balances ? usd(balances.vault) : "—"}</dd>
              <small>{position ? (position.apy !== null ? `${(position.apy > 1 ? position.apy : position.apy * 100).toFixed(2)}% APY` : "DeFindex vault") : "vault not configured on the API"}</small>
            </div>
            <div>
              <dt>Yield earned</dt>
              <dd>
                <mark>
                  +<CountUp value={earnedUsdc} format={(n) => usd(n, 6)} />
                </mark>
              </dd>
              <small>vault value − what you put in</small>
            </div>
            <div>
              <dt>Agent budget left today</dt>
              <dd>{policy ? <CountUp value={policy.remainingUsdc} format={(n) => usd(n)} /> : "—"}</dd>
              <div className="meter" role="img" aria-label={policy ? `${usd(policy.usedUsdc)} of ${usd(policy.capUsdc)} used` : "loading"}>
                <i style={{ width: `${policy ? Math.min(100, (policy.usedUsdc / Math.max(policy.capUsdc, 0.0001)) * 100) : 0}%` }} />
              </div>
            </div>
          </dl>
        </Rise>
        <CliConnect open={idle} />
      </section>

      <LiveFlow />

      <Rise className="dash-cols">
        <AgentConsole />
        <Budget pending={pending} />
      </Rise>

      <History events={events} />
    </>
  );
}

/** Deposits are made from the terminal. This mints a CLI session for this account and shows the two commands. */
function CliConnect({ open }: { open: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) setShown(true);
  }, [open]);
  const commands = token ? `pnpm agent connect ${token}\npnpm agent onramp 3000` : "";

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setToken(await api().cliToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!shown) {
    return (
      <p className="hero-hint mono">
        deposits come from the terminal ·{" "}
        <button type="button" className="term-link ink" onClick={() => setShown(true)}>
          connect the CLI →
        </button>
      </p>
    );
  }
  return (
    <div className="cli-box mono">
      <header>
        <span>add lira from your terminal</span>
        {token ? (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(commands).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              });
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void connect()}>
            {busy ? "creating a CLI key…" : "connect the CLI →"}
          </button>
        )}
      </header>
      {token ? (
        <pre>
          <i>$</i> pnpm agent connect {token}
          {"\n"}
          <i>$</i> pnpm agent onramp 3000
        </pre>
      ) : (
        <pre className="dim">
          <i>$</i> pnpm agent connect &lt;your CLI key&gt;
          {"\n"}
          <i>$</i> pnpm agent onramp 3000
        </pre>
      )}
      <small>{error ?? (token ? "This key is a separate session for your account, valid for 7 days. The deposit shows up here the moment it starts." : "Run these in the pera-wallet repo. The key lets the CLI act for this account without your passkey.")}</small>
    </div>
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
      const n = svcName(e.detail.url);
      if (n && !names.includes(n)) names.push(n);
      if (names.length === 3) break;
    }
    return [...names, "weather", "summary", "quote"].filter((n, i, a) => a.indexOf(n) === i).slice(0, 3);
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
        const i = servicesRef.current.indexOf(svcName(e.detail.url) ?? "");
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
    <Rise className="stage dash-stage">
      <div className="stage-bar">
        <span />
        <span />
        <span />
        <em>live · this moves when your money does</em>
      </div>
      <FlowScene
        ref={ref}
        step={step}
        command="pera onramp 3000"
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
    </Rise>
  );
}

// the three demo paywalls of apps/resource-server
const PRESETS: Record<string, { url: string; prefer: PayPrefer }> = {
  "weather · Stellar": { url: `${RESOURCE_SERVER_URL}/api/stellar/weather`, prefer: "auto" },
  "summary · Base": { url: `${RESOURCE_SERVER_URL}/api/base/summary`, prefer: "evm" },
  "quote · either": { url: `${RESOURCE_SERVER_URL}/api/any/quote`, prefer: "auto" },
};

/** A terminal, like the one on the landing page — except this one really sends the agent out. */
function AgentConsole() {
  const { refresh } = useApp();
  const [preset, setPreset] = useState(Object.keys(PRESETS)[0]);
  const [url, setUrl] = useState(PRESETS[preset].url);
  const [prefer, setPrefer] = useState<PayPrefer>("auto");
  const [busy, setBusy] = useState<null | "pay" | "cap">(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<{ text: string; kind: "cap" | "rule" | "err" } | null>(null);

  async function run(fn: () => Promise<void>, which: "pay" | "cap") {
    setBusy(which);
    setError(null);
    setResult(null);
    try {
      await fn();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : String(err), kind: err instanceof CapExceededError ? "cap" : err instanceof RuleViolationError ? "rule" : "err" });
    } finally {
      setBusy(null);
      void refresh();
    }
  }
  const pay = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => setResult(await api().pay(url.trim(), prefer)), "pay");
  };
  const overCap = () => void run(async () => setError({ text: await api().overCapDemo(), kind: "cap" }), "cap");

  return (
    <section className="term">
      <header>
        <span>agent console</span>
        <em>x402</em>
      </header>
      <div className="term-tabs">
        <MagnetTabs
          slug="paywall"
          options={Object.keys(PRESETS)}
          activeTab={preset}
          onSelect={(k) => {
            setPreset(k);
            setUrl(PRESETS[k].url);
            setPrefer(PRESETS[k].prefer);
          }}
        />
      </div>
      <form onSubmit={pay}>
        <label className="term-line mono">
          <span>$ pera pay</span>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPrefer("auto");
            }}
            spellCheck={false}
            aria-label="Paywalled URL"
          />
        </label>
        <div className="term-actions">
          <ArrowFillButton as="button" type="submit" disabled={busy !== null || !url.trim()} {...BTN}>
            {busy === "pay" ? "Paying…" : "Send the agent"}
          </ArrowFillButton>
          <button type="button" className="term-link" disabled={busy !== null} onClick={overCap}>
            {busy === "cap" ? "asking the chain…" : "try to overspend →"}
          </button>
        </div>
      </form>
      <div className="term-out mono" aria-live="polite">
        {!result && !error && <p className="dim">{busy ? "› working…" : "› the agent's receipt shows up here"}</p>}
        {result && (
          <>
            {result.timeline.map((t, i) => (
              <p key={i} className="dim">
                › {t}
              </p>
            ))}
            <p>
              <mark>{result.paid ? "paid" : `HTTP ${result.status}`}</mark>
              {result.amountUsdc !== null && ` ${usd(result.amountUsdc, 3)}`}
              {result.network && ` on ${result.network.startsWith("eip155") ? "Base Sepolia" : "Stellar"}`}
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
          </>
        )}
        {error && (
          <>
            <p>
              <mark>{error.kind === "cap" ? "the contract said no" : error.kind === "rule" ? "blocked by your rules" : "error"}</mark>
            </p>
            <p>{error.text}</p>
          </>
        )}
      </div>
    </section>
  );
}

function Budget({ pending }: { pending: PeraEvent[] }) {
  const { policy, rules } = useApp();
  const chains = rules ? NETWORKS.filter((n) => rules.allowedNetworks.includes(n.id)).map((n) => n.label).join(" + ") : "—";
  return (
    <section className="rulecard dash-budget">
      <header>
        <span>ruleset</span>
        <Link to="/app/rules">
          <em>change →</em>
        </Link>
      </header>
      <div className="row">
        <span>Daily limit</span>
        <b>{policy ? `${usd(policy.usedUsdc)} / ${usd(policy.capUsdc)}` : "—"}</b>
      </div>
      <div className="row">
        <span>Weekly limit</span>
        <b>{rules ? `${usd(rules.spentThisWeekUsdc)} / ${rules.weeklyCapUsdc === null ? "no limit" : usd(rules.weeklyCapUsdc)}` : "—"}</b>
      </div>
      <div className="row">
        <span>Max per call</span>
        <b>{rules ? (rules.maxPerCallUsdc === null ? "no limit" : usd(rules.maxPerCallUsdc, 3)) : "—"}</b>
      </div>
      <div className="row">
        <span>Allowed chains</span>
        <b>{chains}</b>
      </div>
      {pending.length > 0 && (
        <div className="row">
          <span>In flight</span>
          <b>
            {pending.map((e) => (e.type === "onramp.started" ? `₺${tryOf(e)?.toLocaleString("en-US") ?? "…"} deposit` : "bridge to Base")).join(" · ")}
            <i className="spinner" />
          </b>
        </div>
      )}
    </section>
  );
}

const PAGE = 8;

/** Newest first, a fixed page of rows, numbered pages underneath — the table never grows down the screen. */
function History({ events }: { events: PeraEvent[] }) {
  const [filter, setFilter] = useState("All");
  const [page, setPage] = useState(1);
  const rows = useMemo(() => events.map((e) => ({ e, d: describe(e) })).filter((r) => r.e.type !== "x402.402" && (FILTERS[filter] === "all" || r.d.kind === FILTERS[filter])), [events, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  return (
    <Rise className="dash-section">
      <div className="section-head">
        <h2 className="section-title">History</h2>
        <MagnetTabs
          slug="history"
          options={Object.keys(FILTERS)}
          activeTab={filter}
          onSelect={(k) => {
            setFilter(k);
            setPage(1);
          }}
        />
      </div>
      {rows.length === 0 ? (
        <p className="empty">Nothing here yet. Deposits, vault moves and agent payments land here with their transaction.</p>
      ) : (
        <>
          <div className="history-wrap" style={{ minHeight: pages > 1 ? 45 + PAGE * 57 : undefined }}>
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
                {shown.map(({ e, d }) => (
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
          </div>
          {pages > 1 && <Pager page={current} pages={pages} onPage={setPage} total={rows.length} />}
        </>
      )}
    </Rise>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  // 1 … 4 5 6 … 12 — first, last and a window around the current page
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <nav className="pager" aria-label="History pages">
      <span className="mono">
        {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total} · newest first
      </span>
      <div>
        <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Newer">
          ←
        </button>
        {nums.map((n, i) => (
          <span key={n}>
            {i > 0 && n - nums[i - 1] > 1 && <i>…</i>}
            <button type="button" className={n === page ? "on" : ""} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>
              {n}
            </button>
          </span>
        ))}
        <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Older">
          →
        </button>
      </div>
    </nav>
  );
}
