import { AnimatePresence, animate, motion } from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CLI_NAME } from "./brand";

/**
 * Animated money flow: Bank (TRY) → Anchor (USDC) → Yield vault → AI agent → x402 services.
 *
 * - Landing page: <FlowScene /> loops on its own.
 * - Dashboard:    <FlowScene step={n} ref={r} /> — drive `step` from real events and
 *                 call r.current.pay(serviceIndex) whenever the agent settles an x402 payment.
 *                 Pass `autoPay` to keep the simulated payments while controlling `step` (scroll-driven landing).
 */

export type FlowStep = 0 | 1 | 2 | 3 | 4; // idle, deposit, convert, stake, live
export type FlowSceneHandle = { pay: (service?: number) => void };

const YELLOW = "#FFD400";
const INK = "#0A0A0A";
const MUTED = "#8A8A8A";
const LINE = "#D6D6D6";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const STEP_MS = [2800, 1500, 1500, 1900, 9500];
const CAPTIONS = [
  "Send TRY from your bank",
  "Anchor converts to USDC",
  "USDC goes into the vault",
  "Yield accrues · agent pays over x402",
];

const Y = 290;
const BANK = { x: 120, y: Y };
const ANCHOR = { x: 370, y: Y };
const VAULT = { x: 650, y: Y };
const AGENT = { x: 900, y: Y };
const SERVICES = [
  { x: 1100, y: 150, name: "LLM API", price: 0.02 },
  { x: 1100, y: 290, name: "FX data", price: 0.005 },
  { x: 1100, y: 430, name: "Search", price: 0.01 },
];

const SEG_DEPOSIT = "M168,290 L322,290";
const SEG_STAKE = "M418,290 L586,290";
const SEG_AGENT = "M714,290 L852,290";
const svcPath = (sy: number) => `M948,290 C1010,290 995,${sy} 1052,${sy}`;

// vault → agent (straight) → service (cubic), sampled into keyframes
function paymentKeyframes(sy: number) {
  const xs = [714, 900];
  const ys = [Y, Y];
  const N = 10;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    xs.push(u * u * u * 948 + 3 * u * u * t * 1010 + 3 * u * t * t * 995 + t * t * t * 1052);
    ys.push(u * u * u * Y + 3 * u * u * t * Y + 3 * u * t * t * sy + t * t * t * sy);
  }
  const times = xs.map((_, i) => (i === 0 ? 0 : i === 1 ? 0.42 : 0.42 + (0.58 * (i - 1)) / N));
  return { xs, ys, times };
}

type Particle = { id: number; svc: number };

/** Real numbers for the dashboard; anything left out falls back to the landing page's illustration values. */
export type FlowLive = { quote?: string; quoteSub?: string; staked?: number; earned?: number; spent?: number; calls?: number; cap?: number; services?: string[] };
type Props = { step?: FlowStep; command?: string; autoPay?: boolean; live?: FlowLive };

export const FlowScene = forwardRef<FlowSceneHandle, Props>(function FlowScene(
  { step: controlledStep, command = `${CLI_NAME} deposit 3000 TRY`, autoPay, live },
  ref,
) {
  const controlled = controlledStep !== undefined;
  const [innerStep, setInnerStep] = useState<FlowStep>(0);
  const step = controlled ? controlledStep : innerStep;

  const [typed, setTyped] = useState(0);
  const [balance, setBalance] = useState(0);
  const [yieldAmt, setYieldAmt] = useState(0);
  const [spent, setSpent] = useState(0);
  const [calls, setCalls] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [flash, setFlash] = useState<number[]>([0, 0, 0]);
  const nextId = useRef(0);

  const pay = useCallback((service?: number) => {
    const id = nextId.current++;
    setParticles((p) => [...p, { id, svc: service ?? id % SERVICES.length }]);
  }, []);
  useImperativeHandle(ref, () => ({ pay }), [pay]);

  // loop mode: advance on a timer
  useEffect(() => {
    if (controlled) return;
    const t = setTimeout(() => setInnerStep((s) => ((s + 1) % 5) as FlowStep), STEP_MS[step]);
    return () => clearTimeout(t);
  }, [step, controlled]);

  // reset when the story restarts
  useEffect(() => {
    if (step !== 0) return;
    setBalance(0);
    setYieldAmt(0);
    setSpent(0);
    setCalls(0);
    setParticles([]);
  }, [step]);

  // CLI typing
  useEffect(() => {
    if (step !== 0) {
      setTyped(command.length);
      return;
    }
    setTyped(0);
    const t = setInterval(() => setTyped((n) => Math.min(n + 1, command.length)), 55);
    return () => clearInterval(t);
  }, [step, command]);

  // vault balance counts up once the coin lands
  useEffect(() => {
    if (step < 3) return;
    if (step > 3) {
      setBalance(61.18);
      return;
    }
    const c = animate(0, 61.18, { duration: 0.7, delay: 1.05, onUpdate: setBalance });
    return () => c.stop();
  }, [step]);

  // yield ticker + (loop mode only) simulated agent payments
  useEffect(() => {
    if (step !== 4) return;
    const y = setInterval(() => setYieldAmt((v) => v + 0.000004 + Math.random() * 0.000003), 60);
    const p = controlled && !autoPay ? null : setInterval(() => pay(), 1000);
    return () => {
      clearInterval(y);
      if (p) clearInterval(p);
    };
  }, [step, controlled, autoPay, pay]);

  const settle = (pt: Particle) => {
    setParticles((ps) => ps.filter((x) => x.id !== pt.id));
    setFlash((f) => f.map((n, i) => (i === pt.svc ? n + 1 : n)));
    setSpent((s) => s + SERVICES[pt.svc].price);
    setCalls((c) => c + 1);
  };

  const typing = step === 0 && typed < command.length;

  return (
    <div className="flow" data-step={step}>
      <svg viewBox="0 50 1200 440" role="img" aria-label="TRY becomes USDC, earns yield in a vault, and funds AI agent payments over x402">
        {/* rails */}
        <Rail d={SEG_DEPOSIT} active={step >= 1} />
        <Rail d={SEG_STAKE} active={step >= 3} />
        <Rail d={SEG_AGENT} active={step >= 4} />
        {SERVICES.map((s) => (
          <Rail key={s.name} d={svcPath(s.y)} active={step >= 4} />
        ))}

        {/* x402 payment particles — drawn under the nodes so they pass "through" the agent */}
        {particles.map((pt) => {
          const k = paymentKeyframes(SERVICES[pt.svc].y);
          return (
            <motion.circle
              key={pt.id}
              r={6}
              fill={YELLOW}
              stroke={INK}
              strokeWidth={1.5}
              initial={{ cx: k.xs[0], cy: k.ys[0] }}
              animate={{ cx: k.xs, cy: k.ys }}
              transition={{ duration: 1.5, ease: "linear", times: k.times }}
              onAnimationComplete={() => settle(pt)}
            />
          );
        })}

        {/* big coins */}
        <AnimatePresence>
          {step === 1 && <Coin key="try" glyph="₺" from={168} to={322} />}
          {step === 3 && <Coin key="usd" glyph="$" from={418} to={586} />}
        </AnimatePresence>

        {/* nodes */}
        <Node {...BANK} active={step === 0 || step === 1} label="Your bank" sub="TRY · bank transfer">
          <BankIcon />
        </Node>

        <Node {...ANCHOR} active={step === 2} label="Anchor" sub="SEP-6 · SEP-38">
          <AnimatePresence mode="wait">
            <motion.text
              key={step >= 2 ? "usd" : "try"}
              textAnchor="middle"
              y={13}
              fontSize={38}
              fontWeight={800}
              fill={INK}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ duration: 0.25 }}
            >
              {step >= 2 ? "$" : "₺"}
            </motion.text>
          </AnimatePresence>
        </Node>

        <Node {...VAULT} size={128} active={step >= 3} label="Yield vault" sub="staked · always earning">
          <motion.g
            animate={step >= 4 ? { rotate: 360 } : { rotate: 0 }}
            transition={step >= 4 ? { duration: 8, ease: "linear", repeat: Infinity } : { duration: 0.3 }}
          >
            <circle r={30} fill="none" stroke={INK} strokeWidth={2.25} />
            <path d="M-30,0 H30 M0,-30 V30" stroke={INK} strokeWidth={2.25} />
            <circle r={9} fill={INK} />
          </motion.g>
        </Node>

        <Node {...AGENT} active={step >= 4} label="AI agent" sub="pays per request · x402">
          <AgentIcon awake={step >= 4} />
        </Node>

        {SERVICES.map((s, i) => (
          <g key={s.name} transform={`translate(${s.x},${s.y})`}>
            <motion.rect
              key={flash[i]}
              x={-48}
              y={-28}
              width={96}
              height={56}
              rx={12}
              stroke={INK}
              strokeWidth={1.5}
              initial={{ fill: flash[i] ? YELLOW : "#fff" }}
              animate={{ fill: "#fff" }}
              transition={{ duration: 0.9 }}
            />
            <text textAnchor="middle" y={-2} fontSize={14} fontWeight={700} fill={INK}>
              {live?.services?.[i] ?? s.name}
            </text>
            <text textAnchor="middle" y={15} fontSize={10.5} fontFamily={MONO} fill={MUTED}>
              {live?.services ? "x402" : `$${s.price} / call`}
            </text>
            {flash[i] > 0 && (
              <motion.text
                key={`p${flash[i]}`}
                textAnchor="middle"
                fontSize={12}
                fontFamily={MONO}
                fontWeight={700}
                fill={INK}
                initial={{ y: -36, opacity: 1 }}
                animate={{ y: -58, opacity: 0 }}
                transition={{ duration: 1.1 }}
              >
                200 OK · paid
              </motion.text>
            )}
          </g>
        ))}

        {/* CLI chip */}
        <g transform="translate(24,412)">
          <rect width={318} height={44} rx={10} fill={INK} />
          <text x={16} y={28} fontSize={14} fontFamily={MONO} fill="#fff">
            <tspan fill={YELLOW}>$ </tspan>
            {command.slice(0, typed)}
            {typing ? <tspan fill={YELLOW}>▍</tspan> : <tspan fill={YELLOW}> ⏎</tspan>}
          </text>
        </g>

        {/* anchor quote tag */}
        <Tag show={step >= 2} x={370} y={168} w={196} h={54}>
          <text textAnchor="middle" y={-3} fontSize={15} fontWeight={800} fill={INK}>
            {live?.quote ?? "₺3,000 → $61.18"}
          </text>
          <text textAnchor="middle" y={15} fontSize={10.5} fontFamily={MONO} fill={MUTED}>
            {live?.quoteSub ?? "quote locked @ 48.79"}
          </text>
        </Tag>

        {/* vault stats */}
        <Tag show={step >= 3} x={650} y={120} w={204} h={104}>
          <text x={-86} y={-26} fontSize={10.5} fontFamily={MONO} fill={MUTED}>
            STAKED
          </text>
          <text x={86} y={-22} textAnchor="end" fontSize={22} fontWeight={800} fill={INK}>
            ${(live?.staked ?? balance).toFixed(2)}
          </text>
          <line x1={-86} x2={86} y1={-6} y2={-6} stroke={LINE} />
          <text x={-86} y={20} fontSize={10.5} fontFamily={MONO} fill={MUTED}>
            YIELD
          </text>
          <rect x={-8} y={4} width={98} height={24} rx={6} fill={YELLOW} />
          <text x={84} y={21} textAnchor="end" fontSize={13} fontFamily={MONO} fontWeight={700} fill={INK}>
            +${(live?.earned ?? yieldAmt).toFixed(6)}
          </text>
        </Tag>

        {/* agent spend */}
        <Tag show={step >= 4} x={900} y={134} w={236} h={76}>
          <text x={-102} y={-12} fontSize={10.5} fontFamily={MONO} fill={MUTED}>
            AGENT SPEND TODAY
          </text>
          <text x={-102} y={10} fontSize={17} fontWeight={800} fill={INK}>
            ${(live?.spent ?? spent).toFixed(3)}
            <tspan fontSize={12} fontWeight={500} fill={MUTED}>
              {"  "}
              {live?.calls ?? calls} calls
            </tspan>
          </text>
          <text x={-102} y={27} fontSize={10.5} fontFamily={MONO} fill={INK}>
            cap ${(live?.cap ?? 5).toFixed(2)}/day · enforced on-chain
          </text>
        </Tag>

        {/* yield sparks */}
        {step >= 4 &&
          [0, 1, 2].map((i) => (
            <motion.text
              key={i}
              x={600 + i * 50}
              fontSize={18}
              fontWeight={800}
              fill={INK}
              initial={{ y: 222, opacity: 0 }}
              animate={{ y: [222, 196], opacity: [0, 1, 0] }}
              transition={{ duration: 1.6, delay: i * 0.55, repeat: Infinity, repeatDelay: 0.4 }}
            >
              +
            </motion.text>
          ))}
      </svg>

      <ol className="flow-steps">
        {CAPTIONS.map((c, i) => (
          <li key={c} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>
            <span>{i + 1}</span>
            {c}
          </li>
        ))}
      </ol>
    </div>
  );
});

function Rail({ d, active }: { d: string; active: boolean }) {
  return (
    <>
      <path d={d} fill="none" stroke={LINE} strokeWidth={1.75} strokeDasharray="2 8" strokeLinecap="round" />
      <motion.path
        d={d}
        fill="none"
        stroke={INK}
        strokeWidth={1.75}
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: active ? 1 : 0, opacity: active ? 1 : 0 }}
        transition={{ duration: active ? 0.9 : 0.3, ease: "easeInOut" }}
      />
    </>
  );
}

function Coin({ glyph, from, to }: { glyph: string; from: number; to: number }) {
  return (
    <motion.g
      initial={{ x: from, y: Y, scale: 0 }}
      animate={{ x: [from, from, to], y: Y, scale: [0, 1, 1] }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ duration: 1.15, times: [0, 0.2, 1], ease: "easeInOut" }}
    >
      <circle r={19} fill={YELLOW} stroke={INK} strokeWidth={1.5} />
      <text textAnchor="middle" y={7} fontSize={20} fontWeight={800} fill={INK}>
        {glyph}
      </text>
    </motion.g>
  );
}

function Node({
  x,
  y,
  size = 96,
  active,
  label,
  sub,
  children,
}: {
  x: number;
  y: number;
  size?: number;
  active: boolean;
  label: string;
  sub: string;
  children: ReactNode;
}) {
  const h = size / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      <motion.rect
        x={-h}
        y={-h}
        width={size}
        height={size}
        rx={22}
        stroke={INK}
        strokeWidth={1.5}
        initial={false}
        animate={{ fill: active ? YELLOW : "#FFFFFF" }}
        transition={{ duration: 0.35 }}
      />
      {children}
      <text textAnchor="middle" y={h + 30} fontSize={16} fontWeight={800} fill={INK}>
        {label}
      </text>
      <text textAnchor="middle" y={h + 48} fontSize={11} fontFamily={MONO} fill={MUTED}>
        {sub}
      </text>
    </g>
  );
}

function Tag({
  show,
  x,
  y,
  w,
  h,
  children,
}: {
  show: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  children: ReactNode;
}) {
  return (
    <motion.g
      initial={false}
      animate={{ opacity: show ? 1 : 0, x, y: show ? y : y + 10 }}
      transition={{ duration: 0.35 }}
    >
      <rect className="tag" x={-w / 2} y={-h / 2} width={w} height={h} rx={12} fill="#fff" stroke={LINE} strokeWidth={1} />
      {children}
    </motion.g>
  );
}

function BankIcon() {
  return (
    <g stroke={INK} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M-26,-8 L0,-26 L26,-8 Z" fill="#fff" />
      <path d="M-18,-2 V18 M-6,-2 V18 M6,-2 V18 M18,-2 V18" />
      <path d="M-28,25 H28" />
    </g>
  );
}

function AgentIcon({ awake }: { awake: boolean }) {
  return (
    <g>
      <path d="M0,-30 V-20" stroke={INK} strokeWidth={2.25} strokeLinecap="round" />
      <circle cy={-32} r={4} fill={INK} />
      <rect x={-26} y={-20} width={52} height={42} rx={10} fill="#fff" stroke={INK} strokeWidth={2.25} />
      {[-11, 11].map((cx) => (
        <motion.ellipse
          key={cx}
          cx={cx}
          cy={-2}
          rx={4.5}
          fill={INK}
          initial={false}
          animate={{ ry: awake ? [4.5, 4.5, 0.6, 4.5] : 0.8 }}
          transition={awake ? { duration: 3, times: [0, 0.9, 0.95, 1], repeat: Infinity } : { duration: 0.2 }}
        />
      ))}
      <path d="M-9,11 H9" stroke={INK} strokeWidth={2.25} strokeLinecap="round" />
    </g>
  );
}
