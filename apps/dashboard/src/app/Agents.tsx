import { useEffect, useState, type FormEvent } from "react";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { Rise } from "../ui";
import { api, connectKit, SCOPES, type AgentKey, type AgentScope } from "./api";
import { timeAgo } from "./store";

const BTN = { bgColor: "#0a0a0a", textColor: "#ffffff", fillBgColor: "#ffd400", fillTextColor: "#0a0a0a", hoverFillBgColor: "#ffd400", hoverFillTextColor: "#0a0a0a" };

/** Keys for external agents: mint (shown once), connect snippets, list + revoke. The rules page still governs what a key may spend. */
export function Agents() {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [name, setName] = useState("Hermes");
  const [scopes, setScopes] = useState<AgentScope[]>(["read", "pay"]);
  const [busy, setBusy] = useState<null | "create" | string>(null);
  const [fresh, setFresh] = useState<{ key: AgentKey; secret: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try {
      setKeys(await api().agentKeys());
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setBusy("create");
    setNote(null);
    try {
      const r = await api().createAgentKey({ name: name.trim(), scopes });
      setFresh(r);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  async function revoke(id: string) {
    setBusy(id);
    try {
      await api().revokeAgentKey(id);
      if (fresh?.key.id === id) setFresh(null);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const kit = fresh ? connectKit(fresh.secret) : null;
  return (
    <>
      <header className="page-title">
        <h1>Agents</h1>
        <p>Give Hermes, Claude Code or any MCP client a key to this wallet. Keys are scoped and revocable; the daily limit and your rules apply to every one of them.</p>
      </header>

      <Rise className="keys-grid">
        <form className="rules-editor" onSubmit={create}>
          <div className="rulecard">
            <header>
              <span>new key</span>
              <em>{fresh ? "shown once — copy it now" : "read + pay is enough for Hermes"}</em>
            </header>
            <div className="row field">
              <div>
                <span>Name</span>
                <small>so you recognise it in the list</small>
              </div>
              <label className="key-name">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} aria-label="key name" />
              </label>
            </div>
            <div className="row field">
              <div>
                <span>Scopes</span>
                <small>what the agent may call</small>
              </div>
              <div className="chain-toggles">
                {SCOPES.map((s) => {
                  const on = scopes.includes(s.id);
                  return (
                    <button key={s.id} type="button" aria-pressed={on} className={on ? "on" : ""} onClick={() => setScopes(on ? scopes.filter((x) => x !== s.id) : [...scopes, s.id])}>
                      {s.label}
                      <small>{s.hint}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="row save-row">
              <ArrowFillButton as="button" type="submit" disabled={busy !== null || !name.trim() || scopes.length === 0} {...BTN}>
                {busy === "create" ? "Creating…" : "Create key"}
              </ArrowFillButton>
            </div>
          </div>
          {note && <p className="rule-note err">{note}</p>}
        </form>

        <aside className="snippets">
          {kit && fresh ? (
            <>
              <Snippet title={`${fresh.key.name} · key`} hint="not stored — revoke and mint a new one if you lose it" secret text={fresh.secret} />
              <Snippet title="Hermes · ~/.hermes/.env" hint="then paste the YAML into ~/.hermes/config.yaml" text={kit.envLine} />
              <Snippet title="Hermes · config.yaml" hint="also works for the Dokploy bot: PERA_AGENT_TOKEN env" text={kit.snippetYaml} />
              <Snippet title="Claude Code" hint="one command" text={kit.claudeCode} />
              <Snippet title="MCP endpoint" hint="Authorization: Bearer <key>" text={kit.mcpUrl} />
            </>
          ) : (
            <div className="prove">
              <h3>How it connects.</h3>
              <p>The key goes into your agent's environment; the agent talks to this wallet over MCP (`/mcp`). It can quote and pay paywalls, never move funds elsewhere or change your rules.</p>
              <a className="term-link ink" href="https://github.com/feyyazcigim/pera-wallet/tree/main/integrations/hermes" target="_blank" rel="noreferrer">
                Hermes integration guide ↗
              </a>
            </div>
          )}
        </aside>
      </Rise>

      <Rise className="dash-section">
        <h2 className="section-title">Your keys</h2>
        <dl className="accounts">
          {keys === null && <div className="acct skeleton" />}
          {keys?.length === 0 && <p className="muted">No keys yet.</p>}
          {keys?.map((k) => (
            <div key={k.id} className={`acct ${k.revokedAt ? "revoked" : ""}`}>
              <dt>
                {k.name}
                <small>
                  created {timeAgo(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : " · never used"}
                  {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString("en-GB")}` : ""}
                  {k.revokedAt ? " · revoked" : ""}
                </small>
              </dt>
              <dd className="mono">
                {k.scopes.map((s) => (
                  <span key={s} className="chip-scope">
                    {s}
                  </span>
                ))}
                {!k.revokedAt && (
                  <button type="button" disabled={busy !== null} onClick={() => void revoke(k.id)}>
                    {busy === k.id ? "revoking…" : "revoke"}
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Rise>
    </>
  );
}

function Snippet({ title, hint, text, secret }: { title: string; hint: string; text: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`snippet ${secret ? "secret" : ""}`}>
      <header>
        <span>{title}</span>
        <small>{hint}</small>
      </header>
      <pre>{text}</pre>
      <button
        type="button"
        className="term-link ink"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
