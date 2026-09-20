import { useEffect, useState, type FormEvent } from "react";
import { ArrowFillButton } from "@/components/block/arrow-fill-button";
import { MagnetTabs } from "@/components/block/magnet-tabs";
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

  // the snippets are always there; they carry the real key for the one moment it exists
  const token = fresh?.secret ?? "pat_your-key";
  const kit = connectKit(token);
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
              <em>{fresh ? "shown once, copy it now" : "read + pay is all an agent needs"}</em>
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
          {fresh ? (
            <CodeBlock label="key" file={fresh.key.name} note="Shown once. It is not stored; revoke it and make a new one if you lose it." secret text={fresh.secret} />
          ) : (
            <div className="prove">
              <h3>How it connects.</h3>
              <p>
                The key goes into your agent's environment and the agent talks to this wallet over MCP at <code>/mcp</code>. It can quote and pay paywalls. It can never move funds elsewhere, add money or change your rules.
              </p>
              <a className="term-link ink" href="https://github.com/feyyazcigim/pera-wallet/tree/main/integrations/hermes" target="_blank" rel="noreferrer">
                Hermes integration guide ↗
              </a>
            </div>
          )}
          <Connect kit={kit} token={token} />
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

const CLIENTS = ["Claude Code", "Hermes", "Any MCP client"];

/** One terminal card for every way in: pick the client, copy what it needs. */
function Connect({ kit, token }: { kit: ReturnType<typeof connectKit>; token: string }) {
  const [client, setClient] = useState(CLIENTS[0]);
  return (
    <figure className="code connect">
      <div className="term-tabs">
        <MagnetTabs slug="connect" options={CLIENTS} activeTab={client} onSelect={setClient} />
      </div>
      {client === "Claude Code" && <Code label="shell" file="run once in your terminal" text={kit.claudeCode} mark={token} prompt />}
      {client === "Hermes" && (
        <>
          <Code label="env" file="~/.hermes/.env" text={kit.envLine} mark={token} />
          <Code label="yaml" file="~/.hermes/config.yaml" text={kit.snippetYaml} />
        </>
      )}
      {client === "Any MCP client" && <Code label="http" file="Streamable HTTP" text={`${kit.mcpUrl}\nAuthorization: Bearer ${token}`} mark={token} />}
      <figcaption>{client === "Hermes" ? "The same two files work for the hosted bot." : client === "Claude Code" ? "Claude Code can then quote and pay paywalls from this wallet." : "Send the key as a Bearer token on every request."}</figcaption>
    </figure>
  );
}

/** One file or command inside a terminal card: what it is, the code, a copy button. `mark` highlights the key inside it. */
function Code({ label, file, text, prompt, mark }: { label: string; file: string; text: string; prompt?: boolean; mark?: string }) {
  const [copied, setCopied] = useState(false);
  const parts = mark && text.includes(mark) ? text.split(mark) : [text];
  return (
    <section className="code-part">
      <header>
        <span className="code-lang">{label}</span>
        <b>{file}</b>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </header>
      <pre>
        <code>
          {prompt && <i className="code-prompt">$ </i>}
          {parts.map((part, i) => (
            <span key={i}>
              {part}
              {i < parts.length - 1 && <mark>{mark}</mark>}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}

/** The freshly minted key, shown once on its own yellow card. */
function CodeBlock({ label, file, note, text, secret }: { label: string; file: string; note: string; text: string; secret?: boolean }) {
  return (
    <figure className={`code ${secret ? "secret" : ""}`}>
      <Code label={label} file={file} text={text} />
      <figcaption>{note}</figcaption>
    </figure>
  );
}
