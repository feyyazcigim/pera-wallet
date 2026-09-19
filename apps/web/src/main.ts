import { startAuthentication } from "@simplewebauthn/browser";
import { API_URL, RS_URL, api, setToken, token } from "./api";
import { attach, bytesToB64u, getKit } from "./kit";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, v: unknown) => ($(id).textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2));
const log = (line: string, cls = "") => {
  const d = document.createElement("div");
  d.textContent = `${new Date().toLocaleTimeString()}  ${line}`;
  if (cls) d.className = cls;
  $("log").prepend(d);
};

type Me = { user: { id: string; displayName: string }; wallets: { stellar: { smartAccountId: string; credentialId: string; passkeyPublicKey: string | null; agent: string; agentRuleId: number | null; dailyCapUsdc: string; status: string } | null; evm: { address: string; provider: string } | null } };
let me: Me | null = null;
let sse: EventSource | null = null;

$("apiUrl").textContent = API_URL;
$<HTMLInputElement>("url").value = `${RS_URL}/api/stellar/weather`;

async function refreshMe(): Promise<void> {
  if (!token()) {
    me = null;
    show("me", "not logged in");
    return;
  }
  me = await api<Me>("/me");
  show("me", me);
  startStream();
}

function startStream(): void {
  sse?.close();
  sse = new EventSource(`${API_URL}/events/stream?token=${encodeURIComponent(token()!)}`);
  sse.onmessage = (ev) => {
    const e = JSON.parse(ev.data) as { type: string; amountUsdc?: string; txHash?: string; explorerUrl?: string };
    log(`${e.type} ${e.amountUsdc ?? ""} ${e.txHash ?? ""}`);
  };
  for (const t of ["user.registered", "wallet.provisioned", "agent.authorized", "onramp.started", "onramp.completed", "yield.deposited", "yield.withdrawn", "float.topup", "float.topup.rejected", "x402.402", "x402.paid", "bridge.burned", "bridge.attested", "bridge.minted", "offramp.completed"]) {
    sse.addEventListener(t, (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as { type: string; amountUsdc?: string; txHash?: string };
      log(`${e.type} ${e.amountUsdc ?? ""} ${e.txHash ?? ""}`, e.type.endsWith("rejected") ? "bad" : e.type.endsWith("paid") ? "ok" : "");
    });
  }
}

// 1. Register: the passkey ceremony + deploy payload come from the kit; the API submits it sponsored.
$("register").onclick = async () => {
  try {
    const name = $<HTMLInputElement>("name").value || "Demo User";
    const email = $<HTMLInputElement>("email").value || undefined;
    log("creating passkey…");
    const kit = getKit();
    const w = await kit.createWallet("Pera Agent Wallet", name, { autoSubmit: false });
    log(`passkey ${w.credentialId} → smart account ${w.contractId}; registering…`);
    const r = await api<{ token: string }>("/auth/register", {
      displayName: name,
      email,
      credentialId: w.credentialId,
      publicKey: bytesToB64u(w.publicKey),
      contractId: w.contractId,
      relayerPayload: w.relayerPayload,
      dailyCapUsdc: $<HTMLInputElement>("cap").value || undefined,
    });
    setToken(r.token);
    localStorage.setItem("pera.credentialId", w.credentialId);
    await refreshMe();
    log("registered ✔", "ok");
  } catch (err) {
    log(`register failed: ${(err as Error).message}`, "bad");
  }
};

// Login: standard WebAuthn assertion verified by the API (challenge + origin + rpId + signature).
$("login").onclick = async () => {
  try {
    const credentialId = localStorage.getItem("pera.credentialId") ?? undefined;
    const opts = await api<{ challenge: string; rpId: string; allowCredentials: Array<{ id: string; type: "public-key" }> }>("/auth/login/options", { credentialId });
    const assertion = await startAuthentication({ optionsJSON: { challenge: opts.challenge, rpId: opts.rpId, allowCredentials: opts.allowCredentials, userVerification: "required", timeout: 60_000 } });
    const r = await api<{ token: string }>("/auth/login/verify", { challenge: opts.challenge, assertion });
    setToken(r.token);
    localStorage.setItem("pera.credentialId", assertion.id);
    await refreshMe();
    log("logged in ✔", "ok");
  } catch (err) {
    log(`login failed: ${(err as Error).message}`, "bad");
  }
};

$("logout").onclick = async () => {
  await api("/auth/logout", {}).catch(() => undefined);
  setToken(null);
  sse?.close();
  await refreshMe();
};

async function signAndSubmit(path: string, buildPath: string, body: unknown, fn: "add_context_rule" | "execute"): Promise<unknown> {
  if (!me?.wallets.stellar) throw new Error("no wallet");
  const st = me.wallets.stellar;
  const build = await api<{ json: string }>(buildPath, body);
  const kit = await attach({ contractId: st.smartAccountId, credentialId: st.credentialId, publicKeyB64u: st.passkeyPublicKey });
  const tx = kit.wallet!.fromJSON[fn](build.json);
  const signed = await kit.signAdmin(tx, { resolveContextRuleIds: () => [0] }); // passkey prompt
  return api(path, { xdr: signed.toXDR(), ...(body as object) });
}

// 2. Owner approves the agent's capped rule with the passkey; the API submits it with the sponsor key.
$("authorize").onclick = async () => {
  try {
    const dailyCapUsdc = $<HTMLInputElement>("cap").value || undefined;
    const r = await signAndSubmit("/agent/authorize", "/agent/authorize/build", { dailyCapUsdc }, "add_context_rule");
    show("policy", r);
    await refreshMe();
    log("agent authorised ✔", "ok");
  } catch (err) {
    log(`authorize failed: ${(err as Error).message}`, "bad");
  }
};
$("setcap").onclick = async () => {
  try {
    const dailyCapUsdc = $<HTMLInputElement>("cap").value;
    show("policy", await signAndSubmit("/agent/policy", "/agent/policy/build", { dailyCapUsdc }, "execute"));
    log("cap updated ✔", "ok");
  } catch (err) {
    log(`set cap failed: ${(err as Error).message}`, "bad");
  }
};

// 3. Funding and balances.
$("onramp").onclick = async () => {
  try {
    const r = await api<{ anchorTxId: string }>("/onramp", { amountTry: $<HTMLInputElement>("try").value });
    show("bal", r);
    log(`on-ramp started ${r.anchorTxId}`);
  } catch (err) {
    log(`onramp failed: ${(err as Error).message}`, "bad");
  }
};
$("balances").onclick = async () => show("bal", await api("/balances").catch((e: Error) => e.message));

// 4. Payments.
const pay = async (prefer: "auto" | "evm") => {
  try {
    const url = prefer === "evm" ? `${RS_URL}/api/base/summary` : $<HTMLInputElement>("url").value;
    show("pay-out", "paying…");
    show("pay-out", await api("/agent/pay", { url, prefer }));
  } catch (err) {
    show("pay-out", (err as Error & { body?: unknown }).body ?? (err as Error).message);
  }
};
$("pay").onclick = () => pay("auto");
$("payevm").onclick = () => pay("evm");
$("overcap").onclick = async () => {
  try {
    show("pay-out", await api("/agent/pay/over-cap-demo", {}));
  } catch (err) {
    show("pay-out", (err as Error & { body?: unknown }).body ?? (err as Error).message);
  }
};

void refreshMe().then(() => me && api("/agent/policy").then((p) => show("policy", p)).catch(() => undefined));
