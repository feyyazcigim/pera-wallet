import { useState, type FormEvent } from "react";
import { api, session } from "./api";
import { usd, useApp } from "./store";

/** Rules the backend does not enforce yet — shown as roadmap so the page never claims a control that isn't real. */
const ROADMAP = [
  { name: "Weekly limit", text: "A second, longer window on top of the daily cap." },
  { name: "Max per call", text: "Reject any single payment above a price you choose." },
  { name: "Allowed services", text: "A recipient allowlist — the agent can only pay paywalls you approved." },
  { name: "Pause agent", text: "One switch that freezes all agent spending." },
];

export function Rules() {
  const { me, policy, refresh, loading } = useApp();
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const pct = policy ? Math.min(100, (policy.usedUsdc / Math.max(policy.capUsdc, 0.0001)) * 100) : 0;
  const hours = policy ? Math.round((policy.windowLedgers * 5) / 3600) : 24;

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = Number.parseFloat(cap);
    if (!(n > 0)) return;
    setBusy(true);
    setNote(null);
    try {
      if (!me) throw new Error("Still loading your account.");
      await api().setCap(n, me);
      setNote({ ok: true, text: `Daily cap is now ${usd(n)} — written to the policy contract.` });
      setEditing(false);
      await refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }
  async function overCap() {
    setBusy(true);
    setNote(null);
    try {
      setNote({ ok: true, text: await api().overCapDemo() });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rules</h1>
          <p className="muted">Limits live in a contract on Stellar, not in a prompt. If the agent overspends, the network rejects the transaction.</p>
        </div>
      </header>

      <section className="cols wide-left">
        <section className="panel rule-hero">
          <header>
            <h2>Daily spending cap</h2>
            <span className="chip ink">on-chain</span>
          </header>
          <div className="rule-number">
            <strong className={loading ? "skeleton" : ""}>{policy ? usd(policy.capUsdc) : "—"}</strong>
            <span>
              per {hours} hours · rolling window of {policy?.windowLedgers.toLocaleString("en-US") ?? "17,280"} ledgers
              {policy?.policyUrl && (
                <>
                  {" · "}
                  <a href={policy.policyUrl} target="_blank" rel="noreferrer">
                    policy contract ↗
                  </a>
                </>
              )}
            </span>
          </div>
          <div className="meter tall" role="img" aria-label={policy ? `${usd(policy.usedUsdc, 3)} used of ${usd(policy.capUsdc)}` : "loading"}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="rule-legend">
            <span>
              <b>{policy ? usd(policy.usedUsdc, 3) : "—"}</b> used
            </span>
            <span>
              <b>{policy ? usd(policy.remainingUsdc, 3) : "—"}</b> left
            </span>
          </div>

          {editing ? (
            <form className="rule-edit" onSubmit={save}>
              <label>
                New daily cap in USDC
                <div className="amount">
                  <span>$</span>
                  <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} autoFocus />
                </div>
              </label>
              <p className="muted small">Changing the cap is the one thing that needs your passkey again — the smart account only accepts it signed by you.</p>
              <div className="modal-actions">
                <button type="button" className="btn-line" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-solid" disabled={busy || !(Number.parseFloat(cap) > 0)}>
                  {busy ? "Waiting for your passkey…" : session.isDemo() ? "Save (demo)" : "Sign with passkey"}
                </button>
              </div>
            </form>
          ) : (
            <div className="actions">
              <button
                type="button"
                className="btn-solid"
                onClick={() => {
                  setCap(policy ? String(policy.capUsdc) : "");
                  setEditing(true);
                }}
              >
                Change cap
              </button>
              <button type="button" className="btn-line" disabled={busy} onClick={() => void overCap()}>
                {busy ? "Asking the chain…" : "Prove it: try to overspend"}
              </button>
            </div>
          )}
          {note && <p className={`rule-note ${note.ok ? "ok" : "err"}`}>{note.text}</p>}
        </section>

        <section className="panel">
          <header>
            <h2>How the cap is enforced</h2>
          </header>
          <ol className="explain">
            <li>
              <b>Your passkey owns the account.</b> It is the only signer on rule 0 of your smart account.
            </li>
            <li>
              <b>The agent gets rule 1.</b> It may only move USDC, and only through a <code>spending_limit</code> policy.
            </li>
            <li>
              <b>Every top-up is metered.</b> The agent pulls budget into its float account; the policy adds it to the rolling window.
            </li>
            <li>
              <b>Over the cap, the chain says no.</b> <code>Error(Contract, #3221) SpendingLimitExceeded</code> — no server can override it.
            </li>
          </ol>
        </section>
      </section>

      <section className="panel">
        <header>
          <h2>More rules</h2>
          <span className="chip">roadmap</span>
        </header>
        <ul className="roadmap">
          {ROADMAP.map((r) => (
            <li key={r.name}>
              <div>
                <b>{r.name}</b>
                <small>{r.text}</small>
              </div>
              <span className="chip">not enforced yet</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <header>
          <h2>Your accounts</h2>
        </header>
        <dl className="accounts">
          <Account label="Smart account" hint="owned by your passkey · holds the agent's budget" value={me?.smartAccountId} href={me?.smartAccountUrl} />
          <Account label="Treasury" hint="receives USDC from the anchor · deposits into the vault" value={me?.treasuryPublicKey} href={me?.treasuryUrl} />
          <Account label="Agent float" hint="pays x402 paywalls · topped up under the cap" value={me?.agentPublicKey} href={me?.agentUrl} />
          <Account label="Base wallet" hint="Privy wallet, gas sponsored · funded through Circle CCTP" value={me?.evmAddress} href={me?.evmUrl} />
        </dl>
      </section>
    </>
  );
}

function Account({ label, hint, value, href }: { label: string; hint: string; value?: string | null; href?: string | null }) {
  const [copied, setCopied] = useState(false);
  const real = value && !value.includes("…");
  return (
    <div className="account">
      <dt>
        {label}
        <small>{hint}</small>
      </dt>
      <dd className="mono">
        {value ? (real ? `${value.slice(0, 8)}…${value.slice(-8)}` : value) : "—"}
        {real && (
          <>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
            >
              {copied ? "copied" : "copy"}
            </button>
            {href && (
              <a href={href} target="_blank" rel="noreferrer">
                explorer ↗
              </a>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
