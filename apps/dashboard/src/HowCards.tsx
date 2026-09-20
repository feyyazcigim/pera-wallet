import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * "How it works": a one-screen stepper — five steps on the left, one stage on the right showing the
 * active step's live vignette. Auto-advances while on screen, pauses on hover, click to jump.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;

const STEPS: { n: string; title: string; body: string; tag: string; Visual: () => ReactNode }[] = [
  { n: "01", title: "Send lira", tag: "TRY · FAST / EFT", Visual: TransferVisual,
    body: "A normal bank transfer with a reference code. No exchange account, no seed phrase homework." },
  { n: "02", title: "It lands as USDC", tag: "SEP-6 · SEP-10 · SEP-38", Visual: QuoteVisual,
    body: "A Stellar anchor locks a USD/TRY quote and pays USDC straight to your wallet in seconds." },
  { n: "03", title: "It starts earning", tag: "DeFindex · Blend", Visual: YieldVisual,
    body: "USDC is deposited into a yield vault automatically. Your balance never sits idle." },
  { n: "04", title: "Your agent pays its own way", tag: "x402 · Soroban", Visual: PaymentsVisual,
    body: "The agent settles API calls over x402, per request, inside the limits you set on-chain." },
  { n: "05", title: "One vault, Stellar or Base", tag: "Circle CCTP · Stellar domain 27", Visual: ChainsVisual,
    body: "Lira comes in once and becomes USDC on Stellar. Paywalls on Stellar are paid natively. When one lives on Base, Circle CCTP burns that USDC on Stellar and mints it there. No bridges, no wrapped tokens, the same rules." },
];

const DWELL = 6.5; // seconds per step before it moves on by itself

/** One screen: the steps on the left, a single stage on the right that shows the active step's vignette. */
export function HowCards() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-25% 0px" });
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState(false);
  const running = inView && !hover;
  const { Visual } = STEPS[active];

  return (
    <motion.div
      className="steps"
      ref={ref}
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.65, ease: EASE }}
    >
      <ol className="steps-list" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {STEPS.map((s, i) => {
          const on = i === active;
          return (
            <li key={s.n} className={on ? "on" : ""}>
              <button type="button" onClick={() => setActive(i)} aria-expanded={on}>
                <b>{s.n}</b>
                <span>{s.title}</span>
              </button>
              <motion.div className="steps-body" initial={false} animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
                <p>{s.body}</p>
                <code>{s.tag}</code>
              </motion.div>
              {on && (
                <motion.i
                  key={`${active}-${running}`}
                  className="steps-progress"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: running ? 1 : 0 }}
                  transition={{ duration: running ? DWELL : 0.2, ease: "linear" }}
                  onAnimationComplete={() => running && setActive((v) => (v + 1) % STEPS.length)}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="steps-stage bento">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className="steps-visual"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.985 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <Visual />
          </motion.div>
        </AnimatePresence>
        <span className="steps-count">
          {STEPS[active].n} / 0{STEPS.length}
        </span>
      </div>
    </motion.div>
  );
}

/** Runs `fn` every `ms` while the element is in view. */
function useLoop(ms: number, fn: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-60px" });
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [inView, ms]);
  return { ref, inView };
}

/* 01 — a bank transfer slip: the reference code types itself, the button sends */
const REF = "PERA-7F3K";
function TransferVisual() {
  const [t, setT] = useState(0);
  const { ref } = useLoop(95, () => setT((v) => (v + 1) % 64));
  const typed = REF.slice(0, Math.min(REF.length, Math.floor(t / 2)));
  const typing = t < REF.length * 2 + 2;
  const pressed = t >= 25 && t < 29;
  const sent = t >= 29;
  return (
    <div className="v-slip" ref={ref}>
      <header>
        <span>Bank transfer</span>
        <i>FAST</i>
      </header>
      <dl>
        <dt>To</dt>
        <dd className="mono">TR33 0006 1005 1978 6457 84</dd>
        <dt>Reference</dt>
        <dd>
          <span className="v-ref mono">
            {typed}
            {typing && <em />}
          </span>
        </dd>
        <dt>Amount</dt>
        <dd className="v-amount">₺3,000.00</dd>
      </dl>
      <motion.div
        className="v-send"
        animate={{ scale: pressed ? 0.96 : 1, backgroundColor: sent ? "#ffd400" : "#0a0a0a", color: sent ? "#0a0a0a" : "#ffffff" }}
        transition={{ duration: 0.2 }}
      >
        {sent ? "Sent ✓" : "Send"}
      </motion.div>
    </div>
  );
}

/* 02 — live quote: the rate breathes, the quote re-locks on a timer */
function QuoteVisual() {
  const [rate, setRate] = useState(48.79);
  const [lockKey, setLockKey] = useState(0);
  const beat = useRef(0);
  const { ref, inView } = useLoop(900, () => {
    setRate(48.79 + (Math.random() - 0.5) * 0.08);
    beat.current += 1;
    if (beat.current % 7 === 0) setLockKey((k) => k + 1);
  });
  const usd = (3000 / rate) * 0.995;
  return (
    <div className="v-quote" ref={ref}>
      <div className="v-pair">
        <div>
          <small>you send</small>
          <strong>₺3,000</strong>
        </div>
        <motion.span className="v-arrow" animate={inView ? { x: [0, 8, 0] } : { x: 0 }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
          →
        </motion.span>
        <div>
          <small>you get</small>
          <strong>
            <mark>${usd.toFixed(2)}</mark>
          </strong>
        </div>
      </div>
      <div className="v-rate">
        <span className="mono">USD/TRY</span>
        <motion.b key={rate.toFixed(2)} className="mono" initial={{ opacity: 0.3, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {rate.toFixed(2)}
        </motion.b>
        <span className="v-src mono">Reflector oracle</span>
        <motion.span key={lockKey} className="v-lock mono" initial={{ backgroundColor: "#ffd400" }} animate={{ backgroundColor: "#ffffff" }} transition={{ duration: 1.2 }}>
          quote locked
        </motion.span>
      </div>
      <div className="v-ttl">
        <motion.i key={lockKey} initial={{ scaleX: 1 }} animate={{ scaleX: inView ? 0 : 1 }} transition={{ duration: 6.3, ease: "linear" }} />
      </div>
    </div>
  );
}

/* 03 — the vault: a curve draws itself, the yield counter never stops */
const CURVE = "M0,104 C34,100 52,93 84,88 S132,76 164,66 S226,44 300,20";
function YieldVisual() {
  const [earned, setEarned] = useState(0.000112);
  const { ref, inView } = useLoop(70, () => setEarned((v) => v + 0.000003 + Math.random() * 0.000002));
  return (
    <div className="v-yield" ref={ref}>
      <div className="v-yield-head">
        <div>
          <small>staked</small>
          <strong>$61.18</strong>
        </div>
        <div className="right">
          <small>earned</small>
          <strong className="mono">
            <mark>+${earned.toFixed(6)}</mark>
          </strong>
        </div>
      </div>
      <svg viewBox="0 0 300 124" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="yieldFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd400" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd400" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[31, 62, 93].map((y) => (
          <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#e6e6e6" strokeDasharray="2 6" />
        ))}
        <motion.path d={`${CURVE} L300,124 L0,124 Z`} fill="url(#yieldFill)" initial={false} animate={{ opacity: inView ? 1 : 0 }} transition={{ duration: 1.2, delay: inView ? 1.1 : 0 }} />
        <motion.path
          d={CURVE}
          fill="none"
          stroke="#0a0a0a"
          strokeWidth="1.5"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: inView ? 1 : 0 }}
          transition={{ duration: inView ? 1.9 : 0.2, ease: "easeInOut" }}
        />
      </svg>
    </div>
  );
}

/* 04 — the agent's receipt tape: x402 payments stream in, the daily cap fills honestly */
const CALLS = [
  { path: "POST /v1/llm", price: 0.02 },
  { path: "GET  /fx/usd-try", price: 0.005 },
  { path: "GET  /search?q=…", price: 0.01 },
  { path: "POST /v1/translate", price: 0.008 },
  { path: "GET  /market/xlm", price: 0.005 },
];
type Row = { id: number; path: string; price: number };
function PaymentsVisual() {
  const [rows, setRows] = useState<Row[]>(() => CALLS.slice(0, 3).map((c, i) => ({ id: i, ...c })));
  const [spent, setSpent] = useState(0.035);
  const next = useRef(3);
  const { ref } = useLoop(1400, () => {
    const c = CALLS[next.current % CALLS.length];
    const id = next.current++;
    setRows((r) => [{ id, ...c }, ...r].slice(0, 4));
    setSpent((s) => (s + c.price > 4.8 ? 0 : s + c.price));
  });
  return (
    <div className="v-pay" ref={ref}>
      <div className="v-pay-list">
        {/* new rows grow in from the top and push the tape down; the oldest row is already masked out when it drops */}
        {rows.map((r) => (
          <motion.div
            key={r.id}
            className="v-pay-row mono"
            initial={r.id < 3 ? false : { height: 0, opacity: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
            animate={{ height: 36, opacity: 1, marginBottom: 8, paddingTop: 9, paddingBottom: 9 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <span>{r.path}</span>
            <i>402 → paid</i>
            <b>${r.price.toFixed(3)}</b>
          </motion.div>
        ))}
      </div>
      <div className="v-cap">
        <div className="mono">
          <span>spent today ${spent.toFixed(3)}</span>
          <span>cap $5.00</span>
        </div>
        <u>
          <motion.i animate={{ width: `${Math.max(1.5, (spent / 5) * 100)}%` }} transition={{ duration: 0.4 }} />
        </u>
      </div>
    </div>
  );
}

/* 05: lira comes in once and becomes USDC on Stellar; the agent pays Stellar paywalls natively and Base paywalls through CCTP */
const INBOUND = { via: "Stellar anchor · SEP-6", steps: ["transfer", "quote", "payout"] };
// `live` is honest on purpose: flip a destination to true once it works end to end.
const DESTS = [
  { name: "Stellar", via: "x402 · native", steps: ["sign", "settle", "paid"], live: true },
  { name: "Base", via: "Circle CCTP · domain 6", steps: ["burn", "attest", "mint"], live: false },
];
const CH = { bankX: 24, bankW: 144, hubX: 238, hubW: 164, outX: 488, outW: 128, ty: 108, row: (i: number) => 74 + i * 68 };
type Seg = { x0: number; y0: number; x1: number; y1: number };
const IN_SEG: Seg = { x0: CH.bankX + CH.bankW, y0: CH.ty, x1: CH.hubX, y1: CH.ty };
const outSeg = (i: number): Seg => ({ x0: CH.hubX + CH.hubW, y0: CH.ty, x1: CH.outX, y1: CH.row(i) });
const bend = (g: Seg) => (g.x1 - g.x0) * 0.55;
const segPath = (g: Seg) => `M${g.x0},${g.y0} C${g.x0 + bend(g)},${g.y0} ${g.x1 - bend(g)},${g.y1} ${g.x1},${g.y1}`;
function segKeyframes(g: Seg) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    const u = 1 - t;
    xs.push(u * u * u * g.x0 + 3 * u * u * t * (g.x0 + bend(g)) + 3 * u * t * t * (g.x1 - bend(g)) + t * t * t * g.x1);
    ys.push(u * u * u * g.y0 + 3 * u * u * t * g.y0 + 3 * u * t * t * g.y1 + t * t * t * g.y1);
  }
  return { xs, ys };
}
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function ChainsVisual() {
  const [tick, setTick] = useState(0);
  const { ref, inView } = useLoop(800, () => setTick((v) => v + 1));
  // one round = lira in (3 steps + hold), then USDC out to the next chain (3 steps + hold)
  const round = Math.floor(tick / 8);
  const sel = round % DESTS.length;
  const outbound = tick % 8 >= 4;
  const step = tick % 4;
  const leg = outbound ? DESTS[sel] : { ...INBOUND, live: true };
  const k = segKeyframes(outbound ? outSeg(sel) : IN_SEG);
  return (
    <div className="v-chains" ref={ref}>
      <svg viewBox="0 0 640 236" width="100%" height="100%" aria-hidden="true">
        <path d={segPath(IN_SEG)} fill="none" stroke={outbound ? "#dcdcdc" : "#0a0a0a"} strokeWidth={outbound ? 1.2 : 1.6} strokeDasharray={outbound ? "2 6" : undefined} strokeLinecap="round" />
        {DESTS.map((d, i) => {
          const on = outbound && i === sel;
          return <path key={d.name} d={segPath(outSeg(i))} fill="none" stroke={on ? "#0a0a0a" : "#dcdcdc"} strokeWidth={on ? 1.6 : 1.2} strokeDasharray={on ? undefined : "2 6"} strokeLinecap="round" />;
        })}
        {inView && (
          <motion.circle
            key={`${round}-${outbound}`}
            r={5.5}
            fill="#ffd400"
            stroke="#0a0a0a"
            strokeWidth={1.5}
            initial={{ cx: k.xs[0], cy: k.ys[0], opacity: 0 }}
            animate={{ cx: k.xs, cy: k.ys, opacity: [0, 1, 1, 1, 0] }}
            transition={{ duration: 2.3, ease: "easeInOut", delay: 0.15 }}
          />
        )}

        {/* where the money starts */}
        <g transform={`translate(${CH.bankX},${CH.ty - 15})`}>
          <motion.rect width={CH.bankW} height={30} rx={15} stroke={outbound ? "#e0e0e0" : "#0a0a0a"} strokeWidth={1.2} initial={false} animate={{ fill: outbound ? "#ffffff" : "#0a0a0a" }} transition={{ duration: 0.3 }} />
          <text x={14} y={19.5} fontSize={12.5} fontWeight={700} fill={outbound ? "#0a0a0a" : "#ffffff"}>
            Turkish bank
          </text>
          <text x={CH.bankW - 12} y={19} textAnchor="end" fontSize={9.5} fontFamily={MONO} fill={outbound ? "#9a9a9a" : "#ffd400"}>
            TRY
          </text>
        </g>

        {/* the one place it lives */}
        <g transform={`translate(${CH.hubX},${CH.ty})`}>
          <rect x={0} y={-24} width={CH.hubW} height={48} rx={24} fill="#ffd400" />
          <text x={CH.hubW / 2} y={-2} textAnchor="middle" fontSize={15} fontWeight={700} fill="#0a0a0a">
            USDC on Stellar
          </text>
          <text x={CH.hubW / 2} y={13} textAnchor="middle" fontSize={9.5} fontFamily={MONO} fill="#0a0a0a">
            vault · your rules
          </text>
        </g>

        {/* where it can go to pay */}
        {DESTS.map((d, i) => {
          const on = outbound && i === sel;
          return (
            <g key={d.name} transform={`translate(${CH.outX},${CH.row(i) - 15})`}>
              <motion.rect width={CH.outW} height={30} rx={15} stroke={on ? "#0a0a0a" : "#e0e0e0"} strokeWidth={1.2} initial={false} animate={{ fill: on ? "#0a0a0a" : "#ffffff" }} transition={{ duration: 0.3 }} />
              <text x={14} y={19.5} fontSize={12.5} fontWeight={700} fill={on ? "#ffffff" : "#0a0a0a"}>
                {d.name}
              </text>
              <text x={CH.outW - 12} y={19} textAnchor="end" fontSize={9.5} fontFamily={MONO} fill={on ? "#ffd400" : "#9a9a9a"}>
                USDC
              </text>
            </g>
          );
        })}

        {/* what happens on the leg that is moving */}
        <g transform={`translate(${CH.hubX + CH.hubW / 2},184)`} fontFamily={MONO} fontSize={10}>
          <text textAnchor="middle" y={-6} fill="#6e6e6e">
            {leg.via}
            {leg.live ? "  · live" : "  · next"}
          </text>
          {leg.steps.map((label, i) => {
            const active = step === i;
            const done = step > i;
            return (
              <g key={`${outbound ? sel : "in"}-${label}`} transform={`translate(${(i - 1) * 64 - 29},6)`}>
                <motion.rect width={58} height={22} rx={11} stroke={active || done ? "#0a0a0a" : "#dcdcdc"} strokeWidth={1} initial={false} animate={{ fill: active ? "#ffd400" : "#ffffff" }} transition={{ duration: 0.25 }} />
                <text x={29} y={14.5} textAnchor="middle" fill={active || done ? "#0a0a0a" : "#a5a5a5"}>
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
