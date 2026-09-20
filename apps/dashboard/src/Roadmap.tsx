import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { MagnetTabs } from "@/components/block/magnet-tabs";
import { SmoothScroll } from "@/components/block/smooth-scroll";
import { TextFillAnimation } from "@/components/block/text-fill-animation";
import { EASE, Hl, Line, Rise } from "./ui";

const BTN = { bgColor: "#0a0a0a", textColor: "#ffffff", fillBgColor: "#ffd400", fillTextColor: "#0a0a0a", hoverFillBgColor: "#ffd400", hoverFillTextColor: "#0a0a0a" };

/**
 * x402 volume settled per network, USDC. Source: x402scan.com/networks, the 24 hours to 20 Sep 2026 08:30 UTC.
 * x402scan does not index Stellar yet, so Stellar carries no figure: it is drawn as the floor plus the headroom above it.
 */
const VOLUME: { net: string; usdc: number | null; payments: number | null }[] = [
  { net: "Base", usdc: 13708, payments: 65745 },
  { net: "Solana", usdc: 1460, payments: 17181 },
  { net: "Stellar", usdc: null, payments: null },
];
const TOP = 15000;

const HORIZONS: Record<string, { title: string; text: string }[]> = {
  Now: [
    { title: "Passkey accounts", text: "One press signs you in or sets a wallet up. The passkey owns an OpenZeppelin smart account and nobody holds a seed phrase." },
    { title: "Lira in, working", text: "A bank transfer lands as USDC through a Stellar anchor and moves into a DeFindex vault on its own." },
    { title: "Limits that hold", text: "Daily and weekly caps are policy contracts. Over the limit, the network says no." },
    { title: "Agents that pay", text: "Claude Code, Hermes or any MCP client pays x402 paywalls on Stellar, inside your rules." },
  ],
  Next: [
    { title: "Mainnet lira", text: "The same SEP client pointed at a licensed TRY anchor. The code does not change, only the home domain." },
    { title: "Pay straight from the smart account", text: "No float account in between, once x402 clients and facilitators accept contract payers." },
    { title: "Who the agent may pay", text: "A recipient allowlist and per-merchant budgets, written as policy contracts next to the spending limits." },
    { title: "Real yield", text: "The vault plugs into Blend's USDC strategy on mainnet, so idle money compounds instead of resting." },
    { title: "Approvals in the dashboard", text: "Payments above your threshold wait for a tap. The API already does this; the inbox is next." },
  ],
  Later: [
    { title: "No secrets at rest", text: "The agent and treasury keys move into hardware enclaves, so the backend stores nothing worth stealing." },
    { title: "More corridors", text: "Any currency with a Stellar anchor gets the same product: local money in, agent budget out." },
    { title: "More than USDC", text: "Other assets through intents, with the same caps applied to their value." },
    { title: "Teams of agents", text: "One treasury, many agents, a budget each. Finance sees every call in one ledger." },
    { title: "A market on Stellar", text: "Discovery for x402 services priced in USDC on Stellar, so agents find what to pay for as well as how." },
  ],
};

const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;

export function Roadmap() {
  const [horizon, setHorizon] = useState("Next");
  return (
    <SmoothScroll>
      <header className="nav pill rm-nav">
        <div className="nav-inner">
          <a className="logo" href="/">
            pera
            <i className="logo-dot" />
          </a>
          <nav>
            <a href="/#how">How it works</a>
            <a href="/roadmap" aria-current="page">
              Roadmap
            </a>
          </nav>
          <ArrowFillButton href="/app" {...BTN}>
            Launch app
          </ArrowFillButton>
        </div>
      </header>

      <main className="rm">
        <section className="rm-hero">
          <span className="eyebrow">
            <i /> roadmap
          </span>
          <h1>
            <Line delay={0.05}>Agents started paying.</Line>
            <Line delay={0.18}>
              On Stellar it is <Hl delay={0.75}>day one</Hl>.
            </Line>
          </h1>
          <motion.p className="lede" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.4 }}>
            x402 already moves real money on other networks. Stellar got it in March 2026, with native USDC, five second finality and fees a facilitator can sponsor. The rails are ready. The volume has not arrived yet.
          </motion.p>
        </section>

        <Rise className="rm-chart">
          <VolumeChart />
        </Rise>

        <TextFillAnimation
          text="The rails are here. The volume is not, yet. Whoever makes paying safe for agents on Stellar grows with all of it."
          textColor="#0a0a0a"
          primaryColor="#ffd400"
          dimColor="#dedede"
          backgroundColor="transparent"
          textSize="4vw"
          textWidth="86%"
          height="200vh"
          showDetails={false}
          className="font-bold tracking-[-0.045em]"
        />

        <section className="rm-plan">
          <div className="how-head">
            <h2>
              Where pera. <Hl>goes</Hl> from here.
            </h2>
            <p>Three horizons. The first one already runs on testnet.</p>
          </div>
          <div className="rm-tabs">
            <MagnetTabs slug="horizon" options={Object.keys(HORIZONS)} activeTab={horizon} onSelect={setHorizon} />
          </div>
          <ol className="rm-list" key={horizon}>
            {HORIZONS[horizon].map((item, i) => (
              <motion.li key={item.title} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: i * 0.06, ease: EASE }}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
                {horizon === "Now" && <em>live on testnet</em>}
              </motion.li>
            ))}
          </ol>
        </section>

        <section className="closing rm-closing">
          <h2>
            Start with the part that <Hl>works today</Hl>.
          </h2>
          <ArrowFillButton href="/app" className="lg" {...BTN}>
            Launch app
          </ArrowFillButton>
        </section>
      </main>
    </SmoothScroll>
  );
}

/** Single-series columns: every network in ink, Stellar in yellow with the headroom drawn above it. */
function VolumeChart() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="rm-card" ref={ref}>
      <header>
        <div>
          <h2>x402 volume by network</h2>
          <small>USDC settled in the last 24 hours</small>
        </div>
        <button type="button" className="chip" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? "show chart" : "show table"}
        </button>
      </header>

      {table ? (
        <table className="history rm-table">
          <thead>
            <tr>
              <th>Network</th>
              <th className="num">USDC, 24 h</th>
              <th className="num">Payments</th>
            </tr>
          </thead>
          <tbody>
            {VOLUME.map((v) => (
              <tr key={v.net}>
                <td>{v.net}</td>
                <td className="num mono">{v.usdc === null ? "not indexed yet" : fmt(v.usdc)}</td>
                <td className="num mono">{v.payments === null ? "not indexed yet" : v.payments.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="rm-cols" role="img" aria-label="Column chart. Base 13,708 USDC, Solana 1,460. Stellar is not indexed yet and is drawn with room to grow.">
          <div className="rm-grid" aria-hidden="true">
            {[1, 0.5, 0].map((f) => (
              <span key={f} style={{ bottom: `calc(34px + ${f} * (100% - 34px))` }}>
                {f === 0 ? "$0" : fmt(TOP * f)}
              </span>
            ))}
          </div>
          {VOLUME.map((v, i) => {
            const stellar = v.usdc === null;
            const h = stellar ? 1.4 : Math.max(((v.usdc ?? 0) / TOP) * 100, 0.6);
            return (
              <div key={v.net} className={`rm-col ${stellar ? "stellar" : ""}`} onMouseEnter={() => setHover(v.net)} onMouseLeave={() => setHover(null)}>
                <div className="rm-track">
                  {stellar && (
                    <motion.div className="rm-room" initial={{ opacity: 0 }} animate={seen ? { opacity: 1 } : {}} transition={{ duration: 0.8, delay: 1.1 }}>
                      <span>room to grow</span>
                    </motion.div>
                  )}
                  <motion.div className="rm-bar" initial={{ height: 0 }} animate={seen ? { height: `${h}%` } : {}} transition={{ duration: 0.9, delay: 0.15 + i * 0.1, ease: EASE }}>
                    <b>{stellar ? "day one" : fmt(v.usdc ?? 0)}</b>
                  </motion.div>
                  {hover === v.net && (
                    <div className="tip rm-tip">
                      <b>{stellar ? "Not indexed yet" : fmt(v.usdc ?? 0)}</b>
                      <span>{stellar ? "x402 live since March 2026" : `${(v.payments ?? 0).toLocaleString("en-US")} payments`}</span>
                    </div>
                  )}
                </div>
                <strong>{v.net}</strong>
              </div>
            );
          })}
        </div>
      )}
      <p className="rm-source">Source: x402scan.com, 24 hours to 20 Sep 2026 08:30 UTC. x402scan does not index Stellar yet, so Stellar carries no figure here. x402 has been live on Stellar since March 2026.</p>
    </div>
  );
}
