/**
 * Demo backend — an in-browser stand-in that behaves like the real API (same `Backend` interface),
 * so the dashboard can be built and shown before the backend is reachable. The UI labels it
 * "demo data" everywhere; nothing here touches a chain.
 */
import { CapExceededError, type Backend, type PeraEvent } from "./api";

const KEY = "pera.demo.state";
const RATE = 48.79; // USD/TRY, same figure the landing page uses
const RESERVE = 2; // USDC kept liquid on the treasury (YIELD_RESERVE_USDC)
const APY = 0.08;

type State = {
  name: string;
  treasury: number;
  float: number;
  smartAccount: number;
  vault: number;
  deposited: number;
  base: number;
  cap: number;
  spends: { ts: number; amount: number }[];
  events: PeraEvent[];
  accruedAt: number;
};

const fresh = (name = "Demo user"): State => ({
  name, treasury: 0, float: 0, smartAccount: 0, vault: 0, deposited: 0, base: 0, cap: 5, spends: [], events: [], accruedAt: Date.now(),
});

let state: State = load();
const listeners = new Set<(e: PeraEvent) => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...(JSON.parse(raw) as State) };
  } catch {
    /* fall through */
  }
  return fresh();
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* demo state just won't survive a reload */
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

function accrue() {
  const now = Date.now();
  state.vault += state.vault * APY * ((now - state.accruedAt) / (365 * 24 * 3600 * 1000));
  state.accruedAt = now;
}
function emit(type: string, amountUsdc: number | null, detail: Record<string, unknown> = {}, network: string | null = "stellar:testnet") {
  const tx = ["onramp.started", "x402.402", "float.topup.rejected", "user.registered"].includes(type) ? null : hash();
  const e: PeraEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type, amountUsdc, network, txHash: tx,
    explorerUrl: null, // demo hashes are not real transactions — never link them to an explorer
    detail,
  };
  state.events = [e, ...state.events].slice(0, 400);
  save();
  listeners.forEach((l) => l(e));
}
const usedToday = () => {
  const since = Date.now() - 24 * 3600 * 1000;
  state.spends = state.spends.filter((s) => s.ts >= since);
  return state.spends.reduce((a, s) => a + s.amount, 0);
};
function priceFor(url: string) {
  const u = url.toLowerCase();
  if (u.includes("weather")) return 0.01;
  if (u.includes("llm") || u.includes("chat")) return 0.02;
  if (u.includes("search")) return 0.01;
  return 0.005;
}

/** Agent top-up from the smart account — the step the on-chain cap meters. */
function topUpFloat(amount: number) {
  if (usedToday() + amount > state.cap + 1e-9) {
    emit("float.topup.rejected", amount, { code: "#3221", reason: "SpendingLimitExceeded" });
    throw new CapExceededError(409, "Rejected on-chain: Error(Contract, #3221) SpendingLimitExceeded");
  }
  accrue();
  const short = amount - state.smartAccount;
  if (short > 0) {
    const fromTreasury = Math.min(state.treasury, short);
    state.treasury -= fromTreasury;
    const fromVault = short - fromTreasury;
    if (fromVault > state.vault + 1e-9) throw new Error("Not enough balance — add lira first.");
    if (fromVault > 0) {
      state.vault -= fromVault;
      state.deposited = Math.max(0, state.deposited - fromVault);
      emit("yield.withdrawn", fromVault);
    }
    state.smartAccount += short;
  }
  state.smartAccount -= amount;
  state.float += amount;
  state.spends.push({ ts: Date.now(), amount });
  emit("float.topup", amount, { rule: 1 });
}

export const demoBackend: Backend = {
  async register({ displayName }) {
    await wait(4200); // stands in for the ~30 s on-chain provisioning
    state = fresh(displayName || "Demo user");
    emit("user.registered", null, {}, null);
    emit("wallet.provisioned", null);
    emit("agent.authorized", state.cap, { rule: 1 });
    return "demo";
  },
  async login() {
    await wait(600);
    return "demo";
  },
  async logout() {},
  async me() {
    return {
      id: "demo", displayName: state.name, email: null, status: "ready", statusDetail: null,
      smartAccountId: "CDEMO…SMARTACCOUNT", smartAccountUrl: null, treasuryPublicKey: "GDEMO…TREASURY", treasuryUrl: null,
      agentPublicKey: "GDEMO…AGENT", agentUrl: null, evmAddress: "0xDe00…dEm0", evmUrl: null, credentialId: null, passkeyPublicKey: null,
    };
  },
  async balances() {
    accrue();
    const { treasury, float, smartAccount, vault, base } = state;
    return { treasury, float, smartAccount, vault, base, total: treasury + float + smartAccount + vault + base };
  },
  async position() {
    accrue();
    return { valueUsdc: state.vault, apy: APY, vaultId: "demo-vault", explorerUrl: null };
  },
  async policy() {
    const used = usedToday();
    return { capUsdc: state.cap, usedUsdc: used, remainingUsdc: Math.max(0, state.cap - used), windowLedgers: 17280, transfers: state.spends.length, policyUrl: null };
  },
  async events() {
    return state.events;
  },
  subscribe(onEvent) {
    listeners.add(onEvent);
    return () => listeners.delete(onEvent);
  },
  async onramp(amountTry) {
    if (amountTry < 50 || amountTry > 3000) throw new Error("The anchor accepts 50 – 3000 TRY per deposit.");
    const id = hash().slice(0, 10);
    emit("onramp.started", null, { anchorTxId: id, amountTry: String(amountTry) }, null);
    void (async () => {
      await wait(3200);
      const usd = (amountTry / RATE) * 0.995;
      state.treasury += usd;
      emit("onramp.completed", usd, { anchorTxId: id, amountTry: String(amountTry) });
      await wait(2200);
      accrue();
      const toVault = state.treasury - RESERVE;
      if (toVault >= 1) {
        state.treasury -= toVault;
        state.vault += toVault;
        state.deposited += toVault;
        emit("yield.deposited", toVault, { vault: "demo-vault" });
      }
    })();
  },
  async offramp(amountUsdc) {
    accrue();
    const available = state.treasury + state.vault;
    if (amountUsdc > available + 1e-9) throw new Error(`Only $${available.toFixed(2)} is available to withdraw.`);
    await wait(1800);
    const fromTreasury = Math.min(state.treasury, amountUsdc);
    state.treasury -= fromTreasury;
    const fromVault = amountUsdc - fromTreasury;
    if (fromVault > 0) {
      state.vault -= fromVault;
      state.deposited = Math.max(0, state.deposited - fromVault);
      emit("yield.withdrawn", fromVault);
    }
    emit("offramp.completed", amountUsdc, { amountTry: amountUsdc * RATE * 0.995 });
  },
  async pay(url, prefer = "auto") {
    const price = priceFor(url);
    const network = prefer === "evm" || url.toLowerCase().includes("/base/") ? "eip155:84532" : "stellar:testnet";
    emit("x402.402", price, { url }, network);
    await wait(700);
    const timeline = [`402 Payment Required · $${price.toFixed(3)}`];
    if (state.float < price) {
      topUpFloat(Math.max(price, 0.25));
      timeline.push("float topped up from the smart account (rule 1, capped)");
    }
    await wait(900);
    state.float -= price;
    emit("x402.paid", price, { url }, network);
    const tx = state.events[0].txHash ?? hash();
    timeline.push("payment settled by the facilitator", "200 OK");
    return { paid: true, status: 200, body: { demo: true, url, note: "Demo response — no request left the browser." }, network, amountUsdc: price, txHash: tx, explorerUrl: null, timeline };
  },
  async overCapDemo() {
    await wait(900);
    const attempt = Math.max(0, state.cap - usedToday()) + 1;
    emit("float.topup.rejected", attempt, { code: "#3221", reason: "SpendingLimitExceeded" });
    return `Rejected on-chain: Error(Contract, #3221) SpendingLimitExceeded — tried $${attempt.toFixed(2)} with $${(attempt - 1).toFixed(2)} left under the cap.`;
  },
  async setCap(capUsdc) {
    await wait(1400); // stands in for the passkey prompt + sponsored submit
    state.cap = capUsdc;
    emit("agent.authorized", capUsdc, { rule: 1, change: "cap" });
  },
};
