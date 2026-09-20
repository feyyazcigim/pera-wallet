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
type Mode = "create" | "login";

export function Onboard() {
  const nav = useNavigate();
  // one button: a browser that has been here before signs in, a new one creates a wallet
  const [mode, setMode] = useState<Mode>(() => (session.knowsPasskey() ? "login" : "create"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();
  const stepMs = session.isDemo() ? 800 : 6000;

  useEffect(() => {
    if (session.exists()) nav("/app", { replace: true });
  }, [nav]);

  // the provisioning request is one long call; walk the steps on a clock so the wait is legible
  useEffect(() => {
    if (!busy || mode !== "create") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROVISION_STEPS.length - 1)), stepMs);
    return () => clearInterval(t);
  }, [busy, mode, stepMs]);

  async function run(kind: Mode, demo = false) {
    setError(null);
    setStep(0);
    session.setDemo(demo);
    setMode(kind);
    setBusy(true);
    try {
      const token = kind === "create" ? await api().register({ displayName: name.trim() || "Pera user", email: email.trim() || undefined }) : await api().login();
      session.setToken(demo ? null : token);
      nav("/app", { replace: true });
    } catch (e) {
      session.setDemo(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (kind === "login" && e instanceof ApiError && (e.code === "UNKNOWN_CREDENTIAL" || e.code === "UNKNOWN_USER")) {
        // the hint was stale (different server, wiped database) → fall back to creating a wallet
        session.forgetPasskey();
        setMode("create");
        setError("This server doesn't know that passkey. Create a wallet to continue.");
      } else setError(/NotAllowedError|timed out|not allowed/i.test(msg) ? "The passkey prompt was dismissed. Try again when you're ready." : msg);
      setBusy(false);
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
          {busy && mode === "create" ? (
            <motion.div key="prov" className="onb-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4, ease: EASE }}>
              <span className="eyebrow">
                <i /> about half a minute · keep this tab open
              </span>
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
              {mode === "create" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("create");
                  }}
                >
                  <h2>
                    Create your <mark>wallet</mark>.
                  </h2>
                  <label>
                    What should we call you?
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ayşe" autoComplete="name" autoFocus />
                  </label>
                  <label>
                    <span>
                      Email <em>optional</em>
                    </span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                  </label>
                  <ArrowFillButton as="button" type="submit" className="lg" disabled={!supported || busy} {...BTN}>
                    Continue
                  </ArrowFillButton>
                </form>
              ) : (
                <div className="onb-login">
                  <h2>
                    Welcome <mark>back</mark>.
                  </h2>
                  <p className="muted">This browser has a wallet and your passkey owns it. One prompt and you're in.</p>
                  <ArrowFillButton as="button" type="button" className="lg" disabled={!supported || busy} onClick={() => void run("login")} {...BTN}>
                    {busy ? "Waiting for your passkey…" : "Continue"}
                  </ArrowFillButton>
                </div>
              )}

              {!supported && <p className="onb-error">This browser doesn't support passkeys. Try Safari or Chrome on a device with Touch ID / Face ID.</p>}
              {error && <p className="onb-error">{error}</p>}

              <p className="onb-demo">
                {mode === "create" ? "Already have a wallet? " : "New here? "}
                <button type="button" disabled={busy} onClick={() => { setError(null); setMode(mode === "create" ? "login" : "create"); }}>
                  {mode === "create" ? "Continue with your passkey" : "Create a wallet"}
                </button>
              </p>
              <p className="onb-demo quiet">
                No backend running?{" "}
                <button type="button" onClick={() => void run("create", true)}>
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
