import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, API_URL, session } from "./api";

/** What the API does during the single sign-up request (guide §5.1) — shown while we wait ~30 s. */
const PROVISION_STEPS = [
  { label: "Passkey verified", hint: "your device keeps the key — the server never sees it" },
  { label: "Deploying your smart account", hint: "an OpenZeppelin account on Stellar, owned by your passkey" },
  { label: "Writing the agent's spending rule", hint: "a daily cap, enforced by the contract" },
  { label: "Opening treasury and agent accounts", hint: "reserves and fees are sponsored — you never hold XLM" },
  { label: "Creating your Base wallet", hint: "for paywalls on other chains, via Circle CCTP" },
];

type Mode = "create" | "login";

export function Onboard() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();

  useEffect(() => {
    if (session.exists()) nav("/app", { replace: true });
  }, [nav]);

  // the provisioning request is one long call; walk the steps on a clock so the wait is legible
  useEffect(() => {
    if (!busy || mode !== "create") return;
    const per = session.isDemo() ? 800 : 6000;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROVISION_STEPS.length - 1)), per);
    return () => clearInterval(t);
  }, [busy, mode]);

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
      setError(/NotAllowedError|timed out|not allowed/i.test(msg) ? "The passkey prompt was dismissed. Try again when you're ready." : msg);
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
            One passkey.
            <br />
            No seed phrase.
          </h1>
          <p>Face ID or Touch ID creates your wallet. After that, lira comes in, earns in a vault, and your agent pays within a cap that lives on-chain.</p>
        </div>
        <small>Stellar testnet · {API_URL.replace(/^https?:\/\//, "")}</small>
      </aside>

      <main className="onb-main">
        <AnimatePresence mode="wait">
          {busy && mode === "create" ? (
            <motion.div key="prov" className="onb-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h2>Setting up your wallet</h2>
              <p className="muted">This happens once and takes about half a minute. Keep this tab open.</p>
              <ol className="onb-steps">
                {PROVISION_STEPS.map((s, i) => (
                  <li key={s.label} className={i < step ? "done" : i === step ? "on" : ""}>
                    <span>{i < step ? "✓" : i + 1}</span>
                    <div>
                      <b>{s.label}</b>
                      <small>{s.hint}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </motion.div>
          ) : (
            <motion.div key="form" className="onb-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="seg" role="tablist">
                <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>
                  Create wallet
                </button>
                <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
                  I have a passkey
                </button>
              </div>

              {mode === "create" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("create");
                  }}
                >
                  <h2>Create your wallet</h2>
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
                  <button className="primary" type="submit" disabled={!supported || busy}>
                    Create with passkey
                  </button>
                </form>
              ) : (
                <div>
                  <h2>Welcome back</h2>
                  <p className="muted">Your passkey is the owner of your smart account. One prompt and you're in.</p>
                  <button className="primary" type="button" disabled={!supported || busy} onClick={() => void run("login")}>
                    {busy ? "Waiting for your passkey…" : "Sign in with passkey"}
                  </button>
                </div>
              )}

              {!supported && <p className="onb-error">This browser doesn't support passkeys. Try Safari or Chrome on a device with Touch ID / Face ID.</p>}
              {error && <p className="onb-error">{error}</p>}

              <p className="onb-demo">
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
