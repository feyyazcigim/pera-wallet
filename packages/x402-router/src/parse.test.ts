import { describe, expect, it } from "vitest";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { offerAmountUsdc, offersFrom, pickOffer } from "./parse";

const pr = {
  x402Version: 2,
  resource: { url: "http://rs/api/any/quote" },
  accepts: [
    { scheme: "exact", network: "stellar:testnet", asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", amount: "100000", payTo: "GABC", maxTimeoutSeconds: 60, extra: {} },
    { scheme: "exact", network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "10000", payTo: "0xdef", maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } },
    { scheme: "exact", network: "solana:devnet", asset: "x", amount: "1", payTo: "y", maxTimeoutSeconds: 60, extra: {} },
  ],
};

describe("402 parsing", () => {
  it("decodes the PAYMENT-REQUIRED header and converts amounts per network", () => {
    const header = Buffer.from(JSON.stringify(pr)).toString("base64");
    const http = new x402HTTPClient(new x402Client());
    const decoded = http.getPaymentRequiredResponse((n) => (n.toLowerCase() === "payment-required" ? header : null));
    const offers = offersFrom(decoded);
    expect(offers.map((o) => o.network)).toEqual(["stellar:testnet", "eip155:84532"]);
    expect(offers[0]!.amountUsdc).toBe("0.01");
    expect(offers[1]!.amountUsdc).toBe("0.01");
  });

  it("prefers Stellar unless asked otherwise", () => {
    const offers = offersFrom(pr as never);
    expect(pickOffer(offers).network).toBe("stellar:testnet");
    expect(pickOffer(offers, "evm").network).toBe("eip155:84532");
    expect(pickOffer(offers.filter((o) => o.network === "eip155:84532"), "stellar").network).toBe("eip155:84532");
    expect(() => pickOffer([])).toThrow();
  });

  it("formats raw amounts", () => {
    expect(offerAmountUsdc({ network: "stellar:testnet", amount: "12345678" })).toBe("1.2345678");
    expect(offerAmountUsdc({ network: "eip155:84532", amount: "2500000" })).toBe("2.5");
  });
});
