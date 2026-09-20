import { useMemo, useState, type ReactNode } from "react";
import { Rise } from "../ui";
import { shortUrl, usd, useApp } from "./store";

/**
 * Analytics — everything here is computed from the account's real event log (GET /events).
 * Single-series charts only, so marks are ink and identity comes from titles and labels, never colour.
 */
const DAYS = 14;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function Analytics() {
  const { events, loading } = useApp();

  const stats = useMemo(() => {
    const paid = events.filter((e) => e.type === "x402.paid");
    const spent = paid.reduce((a, e) => a + (e.amountUsdc ?? 0), 0);
    const deposited = events.filter((e) => e.type === "onramp.completed").reduce((a, e) => a + (e.amountUsdc ?? 0), 0);
    const rejected = events.filter((e) => e.type === "float.topup.rejected" || e.type === "x402.rejected").length;

    const days: { key: string; label: string; value: number }[] = [];
    const today = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push({ key: dayKey(d), label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: 0 });
    }
    const byDay = new Map(days.map((d) => [d.key, d]));
    const byService = new Map<string, number>();
    const byNetwork = new Map<string, number>([["Stellar", 0], ["Base Sepolia", 0]]);
    for (const e of paid) {
      const amt = e.amountUsdc ?? 0;
      const slot = byDay.get(dayKey(new Date(e.ts)));
      if (slot) slot.value += amt;
      const svc = typeof e.detail.url === "string" ? shortUrl(e.detail.url) : "unknown";
      byService.set(svc, (byService.get(svc) ?? 0) + amt);
      const net = e.network?.startsWith("eip155") ? "Base Sepolia" : "Stellar";
      byNetwork.set(net, (byNetwork.get(net) ?? 0) + amt);
    }
    const services = [...byService.entries()].sort((a, z) => z[1] - a[1]);
    const top = services.slice(0, 6).map(([label, value]) => ({ label, value }));
    const rest = services.slice(6).reduce((a, [, v]) => a + v, 0);
    if (rest > 0) top.push({ label: "Other", value: rest });
    return { paid: paid.length, spent, deposited, rejected, days, services: top, networks: [...byNetwork.entries()].map(([label, value]) => ({ label, value })) };
  }, [events]);

  return (
    <>
      <header className="page-title">
        <h1>Analytics</h1>
        <p>Computed from your account's event log. Every number traces back to a transaction in History.</p>
      </header>

      <Rise className="tiles">
        <Kpi label="Agent spend, all time" value={usd(stats.spent, 3)} loading={loading} />
        <Kpi label="Payments settled" value={String(stats.paid)} loading={loading} />
        <Kpi label="Average price per call" value={stats.paid ? usd(stats.spent / stats.paid, 4) : "-"} loading={loading} />
        <Kpi label="Blocked by your rules" value={String(stats.rejected)} loading={loading} hint="rejected on-chain or by the router" />
      </Rise>

      <Chart title="Agent spend per day" subtitle={`USDC paid over x402 · last ${DAYS} days`} rows={stats.days.map((d) => ({ label: d.label, value: d.value }))} empty={stats.spent === 0}>
        <Columns data={stats.days} />
      </Chart>

      <section className="cols">
        <Chart title="Spend by service" subtitle="USDC paid per paywall" rows={stats.services} empty={stats.services.length === 0}>
          <HBars data={stats.services} />
        </Chart>
        <Chart title="Spend by network" subtitle="Stellar natively · Base through Circle CCTP" rows={stats.networks} empty={stats.spent === 0}>
          <HBars data={stats.networks} />
        </Chart>
      </section>

      <p className="muted small foot">Deposited so far: {usd(stats.deposited)} · agent spend is {stats.deposited ? ((stats.spent / stats.deposited) * 100).toFixed(2) : "0.00"}% of it.</p>
    </>
  );
}

function Kpi({ label, value, loading, hint }: { label: string; value: string; loading: boolean; hint?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className={loading ? "skeleton" : ""}>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Chart(p: { title: string; subtitle: string; rows: { label: string; value: number }[]; empty: boolean; children: ReactNode }) {
  const [table, setTable] = useState(false);
  return (
    <section className="panel chart">
      <header>
        <div>
          <h2>{p.title}</h2>
          <small className="muted">{p.subtitle}</small>
        </div>
        <button type="button" className="chip" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "show chart" : "show table"}
        </button>
      </header>
      {p.empty ? (
        <p className="empty">No agent payments yet. Send the agent to a paywall from Home and this fills in.</p>
      ) : table ? (
        <table className="history">
          <thead>
            <tr>
              <th>{p.title.includes("day") ? "Day" : "Name"}</th>
              <th className="num">USDC</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num mono">{usd(r.value, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        p.children
      )}
    </section>
  );
}

/** Round the axis top up to a clean number (1 / 2 / 2.5 / 5 × 10ⁿ). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
const tick = (v: number) => (v === 0 ? "0" : v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0));

function Columns({ data }: { data: { key: string; label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 260, L = 56, R = 12, T = 16, B = 34;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const band = (W - L - R) / data.length;
  const bw = Math.min(24, band * 0.6);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  return (
    <div className="plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Agent spend per day, column chart">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#ececec" />
            <text x={L - 10} y={y(max * f) + 4} textAnchor="end" className="axis">
              ${tick(max * f)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + band * i + band / 2;
          const top = y(d.value);
          const h = H - B - top;
          const r = Math.min(4, h);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" />
              {d.value > 0 && (
                <path
                  d={`M${cx - bw / 2},${H - B} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${H - B} Z`}
                  fill={hover === i ? "#ffd400" : "#0a0a0a"}
                />
              )}
              {(i % 2 === data.length % 2 || i === data.length - 1) && (
                <text x={cx} y={H - 12} textAnchor="middle" className="axis">
                  {i === data.length - 1 ? "today" : d.label}
                </text>
              )}
              {i === peak && d.value > 0 && hover === null && (
                <text x={cx} y={top - 8} textAnchor="middle" className="value">
                  {usd(d.value, 3)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#cfcfcf" />
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((L + band * hover + band / 2) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` }}>
          <b>{usd(data[hover].value, 3)}</b>
          <span>{data[hover].label}</span>
        </div>
      )}
    </div>
  );
}

function HBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 0.0001);
  return (
    <ul className="hbars">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${usd(d.value, 3)}`}>
          <span className="mono">{d.label}</span>
          <div>
            <i style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <b className="mono">{usd(d.value, 3)}</b>
        </li>
      ))}
    </ul>
  );
}
