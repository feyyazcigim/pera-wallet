import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { TextStream } from "@/components/block/text-stream";
import { EASE, Hl, Line } from "../ui";
import { api, ApiError, session } from "./api";

/** What the API does during the single sign-up request (guide §5.1) — shown while we wait ~30 s. */
const PROVISION_STEPS = [
  { label: "Passkey verified", hint: "Your device keeps the key. The server never sees it." },
  { label: "Deploying your smart account", hint: "An OpenZeppelin account on Stellar, owned by your passkey." },
  { label: "Writing the agent's spending rule", hint: "A daily cap, enforced by the contract itself." },
  { label: "Opening treasury and agent accounts", hint: "Reserves and fees are sponsored, so you never hold XLM." },
  { label: "Creating your EVM wallet", hint: "For paywalls on other chains, through Circle CCTP." },
];
const PAYS_FOR = ["LLM calls", "FX rates", "web search", "market data", "translations", "image generation", "cloud compute"];
const BTN = { bgColor: "#0a0a0a", textColor: "#ffffff", fillBgColor: "#ffd400", fillTextColor: "#0a0a0a", hoverFillBgColor: "#ffd400", hoverFillTextColor: "#0a0a0a" };
/** idle → checking (is there a passkey on this device?) → creating (no: provision a wallet) */
type Phase = "idle" | "checking" | "creating";

export function Onboard() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();
  const stepMs = session.isDemo() ? 800 : 6000;
  const busy = phase !== "idle";

  useEffect(() => {
    if (session.exists()) nav("/app", { replace: true });
  }, [nav]);

  // the provisioning request is one long call; walk the steps on a clock so the wait is legible
  useEffect(() => {
    if (phase !== "creating") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROVISION_STEPS.length - 1)), stepMs);
    return () => clearInterval(t);
  }, [phase, stepMs]);

  /** One button. `other` is the quiet link for a passkey that lives on another device (phone, security key). */
  async function run(kind: "enter" | "other" | "demo") {
    setError(null);
    setStep(0);
    session.setDemo(kind === "demo");
    setPhase("checking");
    try {
      const who = { displayName: name.trim() || "Pera user" };
      const token = kind === "other" ? await api().login() : await api().enter(who, () => setPhase("creating"));
      session.setToken(kind === "demo" ? null : token);
      nav("/app", { replace: true });
    } catch (e) {
      session.setDemo(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && (e.code === "UNKNOWN_CREDENTIAL" || e.code === "UNKNOWN_USER")) setError("We don't know that passkey. Press Continue to create a wallet.");
      else setError(/NotAllowedError|timed out|not allowed/i.test(`${(e as Error)?.name} ${msg}`) ? "The passkey prompt was dismissed. Try again when you're ready." : msg);
      setPhase("idle");
    }
  }

  return (
    <div className="onb">
      <aside className="onb-side">
        <a className="logo" href="/">
          pera
          <i className="logo-dot" />
        </a>
        <div>
          <h1>
            <Line delay={0.05}>One passkey.</Line>
            <Line delay={0.18}>
              No <Hl delay={0.8}>seed phrase</Hl>.
            </Line>
          </h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.45 }}>
            Face ID or Touch ID creates your wallet. After that, lira comes in, earns in a vault, and your agent pays within limits that you set.
          </motion.p>
        </div>
        <div className="onb-stream">
          <TextStream prefix="Your agent pays for" items={PAYS_FOR} height="150px" fontSize="clamp(1.15rem, 1.7vw, 1.6rem)" fontWeight={700} />
        </div>
      </aside>

      <main className="onb-main">
        <AnimatePresence mode="wait">
          {phase === "creating" ? (
            <motion.div key="prov" className="onb-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease: EASE }}>
              <h2>
                Setting up your <mark>wallet</mark>.
              </h2>
              <ol className="steps-list onb-steps">
                {PROVISION_STEPS.map((s, i) => {
                  const on = i === step;
                  return (
                    <li key={s.label} className={on ? "on" : i < step ? "done" : ""}>
                      <div className="onb-step">
                        <b>{i < step ? "✓" : `0${i + 1}`}</b>
                        <span>{s.label}</span>
                      </div>
                      <motion.div className="steps-body" initial={false} animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
                        <p>{s.hint}</p>
                      </motion.div>
                      {on && <motion.i key={step} className="steps-progress" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: stepMs / 1000, ease: "linear" }} />}
                    </li>
                  );
                })}
              </ol>
            </motion.div>
          ) : (
            <motion.div key="form" className="onb-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease: EASE }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("enter");
                }}
              >
                <h2>
                  Welcome to <mark>pera</mark>.
                </h2>
                <p className="muted onb-lead">One passkey prompt. If this device already has a wallet you're signed in, otherwise we create one for you.</p>
                <label>
                  What should we call you?
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ayşe" autoComplete="name" autoFocus />
                </label>
                <ArrowFillButton as="button" type="submit" className="lg" disabled={!supported || busy} {...BTN}>
                  {busy ? "Waiting for your passkey…" : "Continue"}
                </ArrowFillButton>
              </form>

              {!supported && <p className="onb-error">This browser doesn't support passkeys. Try Safari or Chrome on a device with Touch ID / Face ID.</p>}
              {error && <p className="onb-error">{error}</p>}

              <p className="onb-demo">
                Passkey on your phone or a security key?{" "}
                <button type="button" disabled={busy} onClick={() => void run("other")}>
                  Sign in with it
                </button>
              </p>
              <p className="onb-demo quiet">
                No backend running?{" "}
                <button type="button" disabled={busy} onClick={() => void run("demo")}>
                  Look around with demo data
                </button>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
