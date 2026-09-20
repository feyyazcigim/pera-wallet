import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { MagnetTabs } from "@/components/block/magnet-tabs";
import { Rise } from "../ui";
import { api, NETWORKS, session } from "./api";
import { usd, useApp } from "./store";

type Form = { daily: string; weekly: string; perCall: string; chains: string[] };
const BOTH = NETWORKS.map((n) => n.id as string);
const PRESETS: Record<string, Form> = {
  Cautious: { daily: "1", weekly: "5", perCall: "0.01", chains: ["stellar:testnet"] },
  Balanced: { daily: "5", weekly: "25", perCall: "0.05", chains: BOTH },
  Generous: { daily: "20", weekly: "100", perCall: "0.5", chains: BOTH },
};
const BTN = { bgColor: "#0a0a0a", textColor: "#ffffff", fillBgColor: "#ffd400", fillTextColor: "#0a0a0a", hoverFillBgColor: "#ffd400", hoverFillTextColor: "#0a0a0a" };
const num = (s: string): number | null => (s.trim() === "" ? null : Number.parseFloat(s));
const same = (a: Form, b: Form) => num(a.daily) === num(b.daily) && num(a.weekly) === num(b.weekly) && num(a.perCall) === num(b.perCall) && [...a.chains].sort().join() === [...b.chains].sort().join();

export function Rules() {
  const { me, policy, rules, refresh, loading } = useApp();
  const saved = useMemo<Form | null>(
    () =>
      policy && rules
        ? { daily: String(policy.capUsdc), weekly: policy.weekly ? String(policy.weekly.capUsdc) : rules.weeklyCapUsdc === null ? "" : String(rules.weeklyCapUsdc), perCall: rules.maxPerCallUsdc === null ? "" : String(rules.maxPerCallUsdc), chains: rules.allowedNetworks }
        : null,
    [policy, rules],
  );
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<null | "save" | "prove">(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const dirty = Boolean(form && saved && !same(form, saved));
  const dailyChanged = Boolean(form && saved && num(form.daily) !== num(saved.daily));
  const weeklyChanged = Boolean(form && saved && num(form.weekly) !== num(saved.weekly));
  // the weekly limit is a contract policy: it can move, but once it is there it cannot be blank
  const weeklyOk = Boolean(form && ((num(form.weekly) ?? 0) > 0 || (form.weekly.trim() === "" && !weeklyChanged)));
  const valid = Boolean(form && (num(form.daily) ?? 0) > 0 && weeklyOk && form.chains.length > 0 && (form.perCall.trim() === "" || (num(form.perCall) ?? 0) > 0));
  const preset = form ? (Object.keys(PRESETS).find((k) => same(PRESETS[k], form)) ?? "Custom") : "Custom";
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const hours = policy ? Math.round((policy.windowLedgers * 5) / 3600) : 24;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !saved || !me) return;
    setBusy("save");
    setNote(null);
    try {
      // every change is approved by the owner's passkey. Daily and weekly limits are each a signed on-chain transaction
      // (the first one carries the router rules with it); with neither, the passkey signs the new ruleset itself.
      // The router's copy of the weekly limit only follows the contract, so it rides along unchanged here.
      const router = { weeklyCapUsdc: num(saved.weekly), maxPerCallUsdc: num(form.perCall), allowedNetworks: form.chains };
      const routerChanged = !same({ ...form, daily: saved.daily, weekly: saved.weekly }, saved);
      if (dailyChanged) await api().setCap(num(form.daily)!, me, routerChanged ? router : undefined, "daily");
      if (weeklyChanged) await api().setCap(num(form.weekly)!, me, routerChanged && !dailyChanged ? router : undefined, "weekly");
      if (!dailyChanged && !weeklyChanged) await api().setRules(router);
      await refresh();
      setForm(null);
      const onchain = dailyChanged && weeklyChanged ? "daily and weekly limits are" : dailyChanged ? "daily limit is" : "weekly limit is";
      setNote({ ok: true, text: dailyChanged || weeklyChanged ? `Saved with your passkey. The new ${onchain} written to the policy contract, and the router enforces the rest from now on.` : "Saved with your passkey. The router enforces these on the agent's next payment." });
    } catch (err) {
      await refresh();
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }
  async function prove() {
    setBusy("prove");
    setNote(null);
    try {
      setNote({ ok: true, text: await api().overCapDemo() });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  return (
    <>
      <header className="page-title">
        <h1>Rules</h1>
        <p>Daily and weekly limits are enforced by the contract on Stellar; the rest by pera's router, before the agent signs anything.</p>
      </header>

      <Rise className="rules-grid">
        <form className="rules-editor" onSubmit={save}>
          <MagnetTabs slug="rule-preset" options={[...Object.keys(PRESETS), ...(preset === "Custom" ? ["Custom"] : [])]} activeTab={preset} onSelect={(k) => PRESETS[k] && setForm(PRESETS[k])} />
          <div className="rulecard">
            <header>
              <span>ruleset</span>
              <em>{dirty ? "unsaved changes" : "in force"}</em>
            </header>
            <Field label="Daily limit" hint={`on-chain · rolling ${hours} h`} tag="contract">
              <Money value={form?.daily ?? ""} onChange={(v) => set({ daily: v })} disabled={!form} />
            </Field>
            <Field label="Weekly limit" hint={policy && !policy.weekly ? "rolling 7 days · saving it moves it into the contract" : "on-chain · rolling 7 days"} tag={policy && !policy.weekly ? "router" : "contract"}>
              <Money value={form?.weekly ?? ""} onChange={(v) => set({ weekly: v })} disabled={!form} placeholder="set a limit" />
            </Field>
            <Field label="Max per call" hint="the most a single paywall may charge · leave empty for no limit" tag="router">
              <Money value={form?.perCall ?? ""} onChange={(v) => set({ perCall: v })} disabled={!form} placeholder="no limit" />
            </Field>
            <Field label="Allowed chains" hint="where the agent may pay · at least one" tag="router">
              <div className="chain-toggles">
                {NETWORKS.map((n) => {
                  const on = form?.chains.includes(n.id) ?? false;
                  return (
                    <button key={n.id} type="button" aria-pressed={on} className={on ? "on" : ""} disabled={!form} onClick={() => form && set({ chains: on ? form.chains.filter((c) => c !== n.id) : [...form.chains, n.id] })}>
                      {n.label}
                      <small>{n.hint}</small>
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="row save-row">
              <button type="button" className="term-link ink" disabled={!dirty || busy !== null} onClick={() => setForm(saved)}>
                reset
              </button>
              <ArrowFillButton as="button" type="submit" disabled={!dirty || !valid || busy !== null} {...BTN}>
                {busy === "save" ? "Waiting for your passkey…" : session.isDemo() ? "Save rules" : "Save · sign with passkey"}
              </ArrowFillButton>
            </div>
          </div>
          {dailyChanged && weeklyChanged && busy === null && <p className="rule-note">Two contract changes, so your passkey is asked twice.</p>}
          {note && <p className={`rule-note ${note.ok ? "ok" : "err"}`}>{note.text}</p>}
        </form>

        <aside className="rules-usage">
          <Usage label="Today" sub={`on-chain window · ${policy?.transfers ?? 0} top-up${policy?.transfers === 1 ? "" : "s"}`} used={policy?.usedUsdc} cap={policy?.capUsdc ?? null} loading={loading} link={policy?.policyUrl} />
          {policy?.weekly ? (
            <Usage label="This week" sub={`on-chain window · ${policy.weekly.transfers} top-up${policy.weekly.transfers === 1 ? "" : "s"}`} used={policy.weekly.usedUsdc} cap={policy.weekly.capUsdc} loading={loading} link={policy.weekly.policyUrl} />
          ) : (
            <Usage label="This week" sub={`${rules?.paymentsThisWeek ?? 0} payments settled`} used={rules?.spentThisWeekUsdc} cap={rules ? rules.weeklyCapUsdc : null} loading={loading} />
          )}
          <div className="prove">
            <h3>Don't take our word for it.</h3>
            <p>Ask the agent to pull more than its limit. The smart account's own policy rejects it. The error you get back is the contract's, not ours.</p>
            <button type="button" className="term-link ink" disabled={busy !== null} onClick={() => void prove()}>
              {busy === "prove" ? "asking the chain…" : "try to overspend →"}
            </button>
          </div>
        </aside>
      </Rise>

      <Rise className="dash-section">
        <h2 className="section-title">Your accounts</h2>
        <dl className="accounts">
          <Account label="Smart account" hint="owned by your passkey · holds the agent's budget" value={me?.smartAccountId} href={me?.smartAccountUrl} />
          <Account label="Treasury" hint="receives USDC from the anchor · deposits into the vault" value={me?.treasuryPublicKey} href={me?.treasuryUrl} />
          <Account label="Agent float" hint="pays x402 paywalls · topped up under the daily limit" value={me?.agentPublicKey} href={me?.agentUrl} />
          <Account label="Base wallet" hint="Privy wallet, gas sponsored · funded through Circle CCTP" value={me?.evmAddress} href={me?.evmUrl} />
        </dl>
      </Rise>
    </>
  );
}

function Field({ label, hint, tag, children }: { label: string; hint: string; tag: "contract" | "router"; children: React.ReactNode }) {
  return (
    <div className="row field">
      <div>
        <span>
          {label} <i className={`tag ${tag}`}>{tag}</i>
        </span>
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}
function Money({ value, onChange, disabled, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <label className="money">
      <span>$</span>
      <input inputMode="decimal" value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} aria-label="amount in USDC" />
    </label>
  );
}
function Usage({ label, sub, used, cap, loading, link }: { label: string; sub: string; used?: number; cap: number | null; loading: boolean; link?: string | null }) {
  const pct = cap && used !== undefined ? Math.min(100, (used / Math.max(cap, 0.0001)) * 100) : 0;
  return (
    <div className="usage">
      <small>{label}</small>
      <strong className={loading ? "skeleton" : ""}>
        {used === undefined ? "-" : usd(used, used < 1 ? 3 : 2)}
        <span> / {cap === null ? "no limit" : usd(cap)}</span>
      </strong>
      <div className="meter tall" role="img" aria-label={`${label}: ${used === undefined ? "loading" : usd(used)} used`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <small>
        {sub}
        {link && (
          <>
            {" · "}
            <a href={link} target="_blank" rel="noreferrer">
              policy contract ↗
            </a>
          </>
        )}
      </small>
    </div>
  );
}
function Account({ label, hint, value, href }: { label: string; hint: string; value?: string | null; href?: string | null }) {
  const [copied, setCopied] = useState(false);
  const real = value && !value.includes("…");
  return (
    <div className="acct">
      <dt>
        {label}
        <small>{hint}</small>
      </dt>
      <dd className="mono">
        {value ? (real ? `${value.slice(0, 8)}…${value.slice(-8)}` : value) : "-"}
        {real && (
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
        )}
        {real && href && (
          <a href={href} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        )}
      </dd>
    </div>
  );
}
