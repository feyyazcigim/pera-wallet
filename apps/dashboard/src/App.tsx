import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { BRAND, DASHBOARD_URL, LOGO_SRC } from "./brand";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { MagnetTabs } from "@/components/block/magnet-tabs";
import { SmoothScroll } from "@/components/block/smooth-scroll";
import { TextStream } from "@/components/block/text-stream";
import { TextFillAnimation } from "@/components/block/text-fill-animation";
import { FlowScene, type FlowStep } from "./FlowScene";
import { HowCards } from "./HowCards";
import { Hl, Line } from "./ui";

const PRESETS: Record<string, { k: string; v: string }[]> = {
  Cautious: [
    { k: "Daily limit", v: "$1.00" },
    { k: "Weekly limit", v: "$5.00" },
    { k: "Max per call", v: "$0.01" },
    { k: "Allowed services", v: "1 endpoint" },
  ],
  Balanced: [
    { k: "Daily limit", v: "$5.00" },
    { k: "Weekly limit", v: "$25.00" },
    { k: "Max per call", v: "$0.05" },
    { k: "Allowed services", v: "3 endpoints" },
  ],
  Generous: [
    { k: "Daily limit", v: "$20.00" },
    { k: "Weekly limit", v: "$100.00" },
    { k: "Max per call", v: "$0.50" },
    { k: "Allowed services", v: "any x402 API" },
  ],
};

const PAYS_FOR = ["LLM calls", "FX rates", "web search", "market data", "translations", "image generation", "cloud compute", "flight prices"];

// Obsidian UI arrow-fill button in pera. colors: black pill, yellow coin that floods on hover
const LAUNCH_BTN = {
  bgColor: "#0a0a0a",
  textColor: "#ffffff",
  fillBgColor: "#ffd400",
  fillTextColor: "#0a0a0a",
  hoverFillBgColor: "#ffd400",
  hoverFillTextColor: "#0a0a0a",
};

const SPRING = { stiffness: 140, damping: 26, mass: 0.4 };

function Logo() {
  if (LOGO_SRC) return <img src={LOGO_SRC} alt={BRAND} />;
  // "pera." — the period is the yellow coin
  return (
    <>
      {BRAND.replace(/\.$/, "")}
      <i className="logo-dot" />
    </>
  );
}

const rise = {
  initial: { opacity: 0, y: 48 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-100px" },
  transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] as const },
};

export default function App() {
  const { scrollY } = useScroll();

  // header: full-width bar at the very top, floating pill as soon as you scroll
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const small = vw <= 760;
  // the pill is exactly as wide as the headline's second line: it starts at the Y of "Your" and ends at the full stop
  const headlineRef = useRef<HTMLSpanElement>(null);
  const [headlineW, setHeadlineW] = useState(0);
  useEffect(() => {
    const measure = () => setHeadlineW(headlineRef.current?.offsetWidth ?? 0);
    measure();
    void document.fonts?.ready.then(measure);
  }, [vw]);
  const pillW = small || !headlineW ? Math.min(1120, vw - (small ? 24 : 48)) : Math.min(headlineW, vw - 48);
  const pill = scrolled
    ? { maxWidth: pillW, marginTop: 10, height: small ? 54 : 60, borderRadius: 40, paddingLeft: small ? 20 : 30, paddingRight: 8 }
    : { maxWidth: vw, marginTop: 0, height: small ? 60 : 74, borderRadius: 0, paddingLeft: small ? 20 : 48, paddingRight: small ? 12 : 48 };

  // hero copy drifts up and fades as you scroll away
  const heroOpacity = useTransform(scrollY, [0, 520], [1, 0]);
  const heroY = useTransform(scrollY, [0, 520], [0, -110]);

  // stage: grows in while it enters, then pins — scrolling walks the flow 1 → 2 → 3 → 4
  const pinRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: growRaw } = useScroll({ target: pinRef, offset: ["start end", "start 74px"] });
  const growP = useSpring(growRaw, SPRING);
  const stageScale = useTransform(growP, [0, 1], [0.7, 1]);
  const stageTilt = useTransform(growP, [0, 1], [12, 0]);

  const { scrollYProgress: pinP } = useScroll({ target: pinRef, offset: ["start 74px", "end end"] });
  const [flowStep, setFlowStep] = useState<FlowStep>(0);
  const [preset, setPreset] = useState("Balanced");
  useMotionValueEvent(pinP, "change", (p) => {
    const next = (p < 0.08 ? 0 : p < 0.3 ? 1 : p < 0.52 ? 2 : p < 0.74 ? 3 : 4) as FlowStep;
    setFlowStep((cur) => (cur === next ? cur : next));
  });

  // rules card swings in
  const rulesRef = useRef<HTMLElement>(null);
  const { scrollYProgress: rulesRaw } = useScroll({ target: rulesRef, offset: ["start end", "center center"] });
  const rulesP = useSpring(rulesRaw, SPRING);
  const cardX = useTransform(rulesP, [0, 1], [small ? 0 : 140, 0]); // no sideways slide on a phone: it would push the card off screen
  const cardOpacity = useTransform(rulesP, [0, 0.6], [0, 1]);

  // stack marquee + footer wordmark follow scroll
  const tailRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: tailRaw } = useScroll({ target: tailRef, offset: ["start end", "end end"] });
  const tailP = useSpring(tailRaw, SPRING);
  const wordY = useTransform(tailP, [0.1, 1], ["55%", "0%"]);

  return (
    <SmoothScroll>
      <header className={`nav${scrolled ? " pill" : ""}`}>
        <motion.div className="nav-inner" initial={false} animate={pill} transition={{ type: "spring", stiffness: 260, damping: 32 }}>
          <a className="logo" href="/">
            <Logo />
          </a>
          <nav>
            <a href="#how">How it works</a>
            <a href="#rules">Rules</a>
            <a href="/roadmap">Roadmap</a>
          </nav>
          <ArrowFillButton href={DASHBOARD_URL} {...LAUNCH_BTN}>
            Launch app
          </ArrowFillButton>
        </motion.div>
      </header>

      <main>
        <section className="hero">
          <motion.div style={{ opacity: heroOpacity, y: heroY }}>{/* no scale: the header pill lines up with the headline's edges */}
            <h1>
              <Line delay={0.05}>Your lira earns.</Line>
              <Line delay={0.18}>
                <span ref={headlineRef} className="headline-measure">
                  Your agent <Hl delay={0.75}>spends</Hl>.
                </span>
              </Line>
            </h1>
            <motion.p
              className="lede"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              Send TRY from your bank. It becomes USDC, goes straight into a yield vault, and your AI agent pays for
              what it needs over x402, capped by rules you set on-chain.
            </motion.p>
            <motion.div className="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}>
              <ArrowFillButton href={DASHBOARD_URL} className="lg" {...LAUNCH_BTN}>
                Launch app
              </ArrowFillButton>
              <a className="btn btn-ghost" href="#how">
                See how it works
              </a>
            </motion.div>
          </motion.div>
        </section>

        <div className="pin" ref={pinRef}>
          <div className="pin-sticky">
            <motion.div className="stage" style={{ scale: stageScale, rotateX: stageTilt }}>
              <div className="stage-bar">
                <span />
                <span />
                <span />
                <em>one deposit · money keeps working</em>
              </div>
              <FlowScene step={flowStep} autoPay />
            </motion.div>
          </div>
        </div>

        <TextFillAnimation
          text="Money in the bank sits still. Money in DeFi is locked away. pera. keeps it earning and lets your agent spend it."
          textColor="#0a0a0a"
          primaryColor="#ffd400"
          dimColor="#dedede"
          backgroundColor="transparent"
          textSize="4.3vw"
          textWidth="86%"
          height="220vh"
          showDetails={false}
          className="font-bold tracking-[-0.045em]"
        />

        <section id="how" className="how">
          <div className="how-head">
            <motion.h2 {...rise}>
              Staked <Hl>and</Hl> spendable. At the same time.
            </motion.h2>
            <motion.p {...rise}>You make one deposit. Everything after that happens on its own.</motion.p>
          </div>
          <HowCards />
        </section>

        <section id="rules" className="rules" ref={rulesRef}>
          <motion.div {...rise}>
            <h2>
              An agent with a wallet needs a <Hl>leash</Hl>.
            </h2>
            <p>
              Limits live in a Soroban contract, not in a prompt. If the agent tries to overspend, the transaction is
              rejected by the network. No prompt can talk its way around that.
            </p>
          </motion.div>
          <motion.div style={{ x: cardX, opacity: cardOpacity }}>
            <MagnetTabs slug="preset" options={Object.keys(PRESETS)} activeTab={preset} onSelect={setPreset} />
            <div className="rulecard">
              <header>
                <span>ruleset.contract</span>
                <em>on-chain</em>
              </header>
              {PRESETS[preset].map((r) => (
                <div className="row" key={r.k}>
                  <span>{r.k}</span>
                  <motion.b key={r.v} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                    {r.v}
                  </motion.b>
                </div>
              ))}
              <div className="row">
                <span>Agent status</span>
                <span className="switch">
                  <i /> active
                </span>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <section className="closing">
        <TextStream prefix="Your agent pays for" items={PAYS_FOR} height={small ? "32vh" : "44vh"} fontSize={small ? "1.2rem" : "clamp(2rem, 3.6vw, 3.4rem)"} fontWeight={700} />
        <ArrowFillButton href={DASHBOARD_URL} className="lg" {...LAUNCH_BTN}>
          Launch app
        </ArrowFillButton>
      </section>

      <div ref={tailRef} className="tail">
        <footer>
          <div className="wordmark">
            <motion.div style={{ y: wordY }}>
              pera
              <i />
            </motion.div>
          </div>
          <p>Built in 36 hours at Stellar Pro Hackathon · Istanbul 2026</p>
        </footer>
      </div>
    </SmoothScroll>
  );
}
