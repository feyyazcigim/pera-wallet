import { z } from "zod";

const DecimalUsdc = z.string().regex(/^\d+(\.\d{1,7})?$/, "decimal USDC amount, up to 7 decimals");
const DecimalTry = z.string().regex(/^\d+(\.\d{1,2})?$/, "decimal TRY amount, up to 2 decimals");

export const RegisterBody = z.object({
  displayName: z.string().min(1).max(64),
  email: z.string().email().optional(),
  credentialId: z.string().min(8),
  publicKey: z.string().min(80),
  contractId: z.string().regex(/^C[A-Z2-7]{55}$/),
  relayerPayload: z.object({ func: z.string(), auth: z.array(z.string()) }).optional(),
  dailyCapUsdc: DecimalUsdc.optional(),
});
export const LoginOptionsBody = z.object({ credentialId: z.string().optional() });
export const LoginVerifyBody = z.object({
  challenge: z.string(),
  assertion: z.object({
    id: z.string(),
    rawId: z.string().optional(),
    type: z.string().optional(),
    response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string(), userHandle: z.string().nullable().optional() }),
  }),
});
export const XdrBody = z.object({ xdr: z.string().min(20) });
export const AuthorizeBuildBody = z.object({ dailyCapUsdc: DecimalUsdc.optional() });
export const OnrampBody = z.object({ amountTry: DecimalTry });
export const OfframpBody = z.object({ amountUsdc: DecimalUsdc });
export const AmountBody = z.object({ amountUsdc: DecimalUsdc });
export const PolicyBody = z.object({ dailyCapUsdc: DecimalUsdc });
export const PayBody = z.object({ url: z.string().url(), prefer: z.enum(["auto", "stellar", "evm"]).default("auto") });
export const EvmTransferBody = z.object({ to: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amountUsdc: DecimalUsdc });

export const EventSchema = z.object({
  id: z.string(),
  ts: z.string(),
  type: z.string(),
  userId: z.string().optional(),
  amountUsdc: z.string().optional(),
  network: z.enum(["stellar:testnet", "eip155:84532"]).optional(),
  txHash: z.string().optional(),
  explorerUrl: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export const ErrorSchema = z.object({ error: z.string(), code: z.string().optional(), errorCode: z.number().optional(), detail: z.unknown().optional() });

export const bodySchemas = { RegisterBody, LoginOptionsBody, LoginVerifyBody, XdrBody, AuthorizeBuildBody, OnrampBody, OfframpBody, AmountBody, PolicyBody, PayBody, EvmTransferBody, Event: EventSchema, Error: ErrorSchema };
