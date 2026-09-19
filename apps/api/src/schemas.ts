import { z } from "zod";

const DecimalUsdc = z.string().regex(/^\d+(\.\d{1,7})?$/, "decimal USDC amount, up to 7 decimals");
const DecimalTry = z.string().regex(/^\d+(\.\d{1,2})?$/, "decimal TRY amount, up to 2 decimals");

export const OnrampBody = z.object({ amountTry: DecimalTry });
export const OfframpBody = z.object({ amountUsdc: DecimalUsdc });
export const AmountBody = z.object({ amountUsdc: DecimalUsdc });
export const PolicyBody = z.object({ dailyCapUsdc: DecimalUsdc });
export const PayBody = z.object({
  url: z.string().url(),
  prefer: z.enum(["auto", "stellar", "evm"]).default("auto"),
});

export const EventSchema = z.object({
  id: z.string(),
  ts: z.string(),
  type: z.enum([
    "onramp.started", "onramp.completed", "yield.deposited", "yield.withdrawn", "float.topup", "float.topup.rejected",
    "x402.402", "x402.paid", "bridge.burned", "bridge.attested", "bridge.minted", "offramp.completed",
  ]),
  amountUsdc: z.string().optional(),
  network: z.enum(["stellar:testnet", "eip155:84532"]).optional(),
  txHash: z.string().optional(),
  explorerUrl: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const ErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  errorCode: z.number().optional(),
  detail: z.unknown().optional(),
});

export const bodySchemas = { OnrampBody, OfframpBody, AmountBody, PolicyBody, PayBody, Event: EventSchema, Error: ErrorSchema };
