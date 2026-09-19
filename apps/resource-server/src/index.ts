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
import { ensureAppWallet } from "@pera/evm";
import { BASE_SEPOLIA_CAIP2, childLogger, derivedKeys, loadEnv, STELLAR_CAIP2, X402 } from "@pera/core";
import { fetchIstanbulWeather } from "./weather";

const env = loadEnv();
const log = childLogger("resource-server");

const payToStellar = env.MERCHANT_STELLAR_ADDRESS ?? derivedKeys(env).ownerPub;
// Merchant on Base Sepolia: an explicit address, or an app-owned Privy wallet created on first start.
const payToEvm = env.MERCHANT_EVM_ADDRESS ?? (await ensureAppWallet("merchant")).address;

const facilitators = [new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL })];
if (env.OZ_FACILITATOR_API_KEY) {
  const headers = { Authorization: `Bearer ${env.OZ_FACILITATOR_API_KEY}` };
  facilitators.push(
    new HTTPFacilitatorClient({
      url: X402.ozFacilitatorTestnet,
      createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
    }),
  );
}

const server = new x402ResourceServer(facilitators).register(STELLAR_CAIP2, new ExactStellarScheme()).register(BASE_SEPOLIA_CAIP2, new ExactEvmScheme());

const stellarOffer = { scheme: "exact", price: "$0.01", network: STELLAR_CAIP2, payTo: payToStellar } as const;
const evmOffer = { scheme: "exact", price: "$0.01", network: BASE_SEPOLIA_CAIP2, payTo: payToEvm } as const;

const routes: Record<string, RouteConfig> = {
  "GET /api/stellar/weather": {
    accepts: [stellarOffer],
    description: "Live Istanbul weather (Open-Meteo), paid natively on Stellar",
    mimeType: "application/json",
  },
  "GET /api/base/summary": {
    accepts: [evmOffer],
    description: "Market summary, paid on Base Sepolia (USDC bridged from Stellar via CCTP)",
    mimeType: "application/json",
  },
  "GET /api/any/quote": {
    accepts: [stellarOffer, evmOffer],
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

app.get("/api/stellar/weather", async (_req, res) => {
  try {
    res.json({ city: "Istanbul", ...(await fetchIstanbulWeather()), paidWith: STELLAR_CAIP2, servedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: `weather upstream failed: ${(err as Error).message}` });
  }
});

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
