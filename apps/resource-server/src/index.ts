/**
 * Demo x402 resource server: three paywalled endpoints.
 *   GET /api/stellar/weather  — $0.01 on stellar:testnet
 *   GET /api/base/summary     — $0.01 on eip155:84532 (Base Sepolia)
 *   GET /api/any/quote        — accepts both networks (the agent router prefers Stellar)
 */
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient, type RouteConfig } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ensureAppWallet, isPrivyConfigured } from "@pera/evm";
import { BASE_SEPOLIA_CAIP2, childLogger, derivedKeys, HORIZON_URL, loadEnv, sponsorPublicKey, STELLAR_CAIP2, USDC_CODE, USDC_ISSUER, X402 } from "@pera/core";
import { fetchIstanbulWeather } from "./weather";

const env = loadEnv();
const log = childLogger("resource-server");

// Merchant on Stellar: an explicit address (any testnet account WITH a USDC trustline — e.g. your own treasury from the
// dashboard), else the legacy single-user owner, else the sponsor. Settlement fails without the trustline, so warn early.
const payToStellar = env.MERCHANT_STELLAR_ADDRESS ?? (env.OWNER_SECRET && env.AGENT_SECRET ? derivedKeys(env).ownerPub : sponsorPublicKey(env));
try {
  const acct = (await (await fetch(`${HORIZON_URL}/accounts/${payToStellar}`)).json()) as { balances?: { asset_code?: string; asset_issuer?: string }[] };
  if (!acct.balances?.some((b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER))
    log.error({ payToStellar }, "merchant Stellar account has no USDC trustline — Stellar payments will fail to settle; set MERCHANT_STELLAR_ADDRESS to an account that holds testnet USDC");
} catch (err) {
  log.warn({ err, payToStellar }, "could not check the merchant's USDC trustline");
}
// Merchant on Base Sepolia: an explicit address, or an app-owned Privy wallet created on first start.
const payToEvm = env.MERCHANT_EVM_ADDRESS ?? (isPrivyConfigured() ? (await ensureAppWallet("merchant")).address : undefined);

// Facilitators: X402_FACILITATOR_URL first (x402.org needs no key). OpenZeppelin's needs OZ_FACILITATOR_API_KEY —
// attached automatically when the primary URL is theirs, and it is added as a second facilitator otherwise.
const ozHeaders = env.OZ_FACILITATOR_API_KEY ? { Authorization: `Bearer ${env.OZ_FACILITATOR_API_KEY}` } : undefined;
const isOz = (url: string) => url.includes("openzeppelin.com");
const withAuth = (url: string) =>
  new HTTPFacilitatorClient(
    isOz(url) && ozHeaders ? { url, createAuthHeaders: async () => ({ verify: ozHeaders, settle: ozHeaders, supported: ozHeaders }) } : { url },
  );
const facilitators = [withAuth(env.X402_FACILITATOR_URL)];
// x402.org is the only public facilitator that settles both stellar:testnet and eip155:84532 (Base Sepolia); keep it in
// the set whenever the primary is something else (OpenZeppelin's is Stellar-only), so the Base routes always have one.
if (env.X402_FACILITATOR_URL.replace(/\/$/, "") !== X402.defaultFacilitator) facilitators.push(withAuth(X402.defaultFacilitator));
if (ozHeaders && !isOz(env.X402_FACILITATOR_URL)) facilitators.push(withAuth(X402.ozFacilitatorTestnet));
// A facilitator that answers /supported with anything but 200 makes every paywalled route 500 — say so at boot.
try {
  const r = await fetch(`${env.X402_FACILITATOR_URL.replace(/\/$/, "")}/supported`, { headers: isOz(env.X402_FACILITATOR_URL) ? ozHeaders : undefined });
  if (!r.ok) log.error({ facilitator: env.X402_FACILITATOR_URL, status: r.status }, "facilitator rejected /supported — paywalled routes will fail; use https://x402.org/facilitator or set OZ_FACILITATOR_API_KEY");
} catch (err) {
  log.error({ err, facilitator: env.X402_FACILITATOR_URL }, "facilitator unreachable");
}

const server = new x402ResourceServer(facilitators).register(STELLAR_CAIP2, new ExactStellarScheme());
if (payToEvm) server.register(BASE_SEPOLIA_CAIP2, new ExactEvmScheme());

const stellarOffer = { scheme: "exact", price: "$0.01", network: STELLAR_CAIP2, payTo: payToStellar } as const;
const evmOffer = payToEvm ? ({ scheme: "exact", price: "$0.01", network: BASE_SEPOLIA_CAIP2, payTo: payToEvm } as const) : undefined;

const routes: Record<string, RouteConfig> = {
  "GET /api/stellar/weather": {
    accepts: [stellarOffer],
    description: "Live Istanbul weather (Open-Meteo), paid natively on Stellar",
    mimeType: "application/json",
  },
  ...(evmOffer
    ? {
        "GET /api/base/weather": {
          accepts: [evmOffer],
          description: "Live Istanbul weather (Open-Meteo), paid on Base Sepolia only (USDC bridged from Stellar via CCTP)",
          mimeType: "application/json",
        },
        "GET /api/base/summary": {
          accepts: [evmOffer],
          description: "Market summary, paid on Base Sepolia (USDC bridged from Stellar via CCTP)",
          mimeType: "application/json",
        },
      }
    : {}),
  "GET /api/any/quote": {
    accepts: evmOffer ? [stellarOffer, evmOffer] : [stellarOffer],
    description: "Motivational quote, payable on either network",
    mimeType: "application/json",
  },
};

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true, service: "pera-resource-server", facilitator: env.X402_FACILITATOR_URL, payToStellar, payToEvm, routes: Object.keys(routes) }));
app.get("/", (_req, res) =>
  res.json({
    service: "pera-resource-server",
    endpoints: Object.entries(routes).map(([k, v]) => ({ route: k, description: v.description, accepts: v.accepts })),
  }),
);

app.use(paymentMiddleware(routes, server));

// Same data behind two paywalls: Stellar-only and Base-only, so each rail can be exercised on its own.
const weather = (paidWith: string) => async (_req: express.Request, res: express.Response) => {
  try {
    res.json({ city: "Istanbul", ...(await fetchIstanbulWeather()), paidWith, servedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: `weather upstream failed: ${(err as Error).message}` });
  }
};
app.get("/api/stellar/weather", weather(STELLAR_CAIP2));
app.get("/api/base/weather", weather(BASE_SEPOLIA_CAIP2));

app.get("/api/base/summary", (_req, res) => {
  res.json({
    title: "Stellar × Base agent payments — summary",
    summary:
      "USDC minted on Base Sepolia through Circle CCTP V2 paid for this response. The paying agent's funds live on Stellar in an OpenZeppelin smart account with an on-chain daily cap and a DeFindex vault; cross-chain payments are bridged just in time.",
    bullets: ["TRY → USDC via SEP-6 anchor", "idle USDC in DeFindex", "spending_limit policy enforced in __check_auth", "CCTP burn on Stellar, mint on Base"],
    paidWith: BASE_SEPOLIA_CAIP2,
    servedAt: new Date().toISOString(),
  });
});

const quotes = [
  "Simplicity is the soul of efficiency. — Austin Freeman",
  "The best way to predict the future is to invent it. — Alan Kay",
  "Make it work, make it right, make it fast. — Kent Beck",
];
app.get("/api/any/quote", (_req, res) => {
  res.json({ quote: quotes[Math.floor(Math.random() * quotes.length)], servedAt: new Date().toISOString() });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, "0.0.0.0", () => {
  log.info({ port, payToStellar, payToEvm, facilitator: env.X402_FACILITATOR_URL, routes: Object.keys(routes) }, "resource server listening");
});
