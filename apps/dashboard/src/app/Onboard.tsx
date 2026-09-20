import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { EASE, Hl, Line } from "../ui";
import { toast } from "../toast";
import { api, ApiError, session } from "./api";

/** What the API does during the single sign-up request (guide §5.1) — shown while we wait ~30 s. */
const PROVISION_STEPS = [
  { label: "Passkey verified", hint: "Your device keeps the key. The server never sees it." },
  { label: "Deploying your smart account", hint: "An OpenZeppelin account on Stellar, owned by your passkey." },
  { label: "Writing the agent's spending rule", hint: "A daily cap, enforced by the contract itself." },
  { label: "Opening treasury and agent accounts", hint: "Reserves and fees are sponsored, so you never hold XLM." },
  { label: "Creating your EVM wallet", hint: "For paywalls on other chains, through Circle CCTP." },
];
const BTN = { bgColor: "#0a0a0a", textColor: "#ffffff", fillBgColor: "#ffd400", fillTextColor: "#0a0a0a", hoverFillBgColor: "#ffd400", hoverFillTextColor: "#0a0a0a" };
/** idle → checking (is there a passkey on this device?) → name (no: who is this?) → creating (provision the wallet) */
type Phase = "idle" | "checking" | "name" | "creating";

export function Onboard() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const supported = browserSupportsWebAuthn();
  const stepMs = 6000;
  const busy = phase === "checking" || phase === "creating";

  useEffect(() => {
    if (session.exists()) nav("/app", { replace: true });
  }, [nav]);

  // the provisioning request is one long call; walk the steps on a clock so the wait is legible
  useEffect(() => {
    if (phase !== "creating") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROVISION_STEPS.length - 1)), stepMs);
    return () => clearInterval(t);
  }, [phase, stepMs]);

  const fail = (e: unknown, back: Phase) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ApiError && (e.code === "UNKNOWN_CREDENTIAL" || e.code === "UNKNOWN_USER")) toast("We don't know that passkey. Press Continue to set up a wallet.", "err");
    else toast(/NotAllowedError|timed out|not allowed/i.test(`${(e as Error)?.name} ${msg}`) ? "The passkey prompt was dismissed. Try again when you're ready." : msg, "err");
    setPhase(back);
  };

  /**
   * One Continue. Someone whose passkey is on this device is signed in and never sees a form; only a new person is
   * asked their name.
   */
  async function enter() {
    session.setDemo(false);
    setPhase("checking");
    try {
      const token = await api().signInIfKnown();
      if (token === null) return setPhase("name");
      session.setToken(token);
      nav("/app", { replace: true });
    } catch (e) {
      fail(e, "idle");
    }
  }
  async function create() {
    setStep(0);
    setPhase("creating");
    try {
      session.setToken(await api().register({ displayName: name.trim() || "Pera user" }));
      nav("/app", { replace: true });
    } catch (e) {
      fail(e, "name");
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
              {phase === "name" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <h2>
                    What should we <mark>call you</mark>?
                  </h2>
                  <p className="muted onb-lead">No wallet on this device yet, so we'll set one up. One passkey prompt and it's yours.</p>
                  <label>
                    Your name
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ayşe" autoComplete="name" autoFocus />
                  </label>
                  <ArrowFillButton as="button" type="submit" className="lg" disabled={!supported} {...BTN}>
                    Create my wallet
                  </ArrowFillButton>
                </form>
              ) : (
                <div className="onb-login">
                  <h2>
                    Welcome to <mark>pera</mark>.
                  </h2>
                  <p className="muted onb-lead">One press. If this device already has a wallet you're signed in, otherwise we set one up for you.</p>
                  <ArrowFillButton as="button" type="button" className="lg" disabled={!supported || busy} onClick={() => void enter()} {...BTN}>
                    {busy ? "Waiting for your passkey…" : "Continue"}
                  </ArrowFillButton>
                </div>
              )}

              {!supported && <p className="onb-error">This browser doesn't support passkeys. Try Safari or Chrome on a device with Touch ID / Face ID.</p>}

              {phase === "name" && (
                <p className="onb-demo">
                  <button type="button" onClick={() => setPhase("idle")}>
                    ← back
                  </button>
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
