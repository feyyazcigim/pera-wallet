import { z } from "zod";

export const DecimalUsdc = z.string().regex(/^\d+(\.\d{1,7})?$/, "decimal USDC amount, up to 7 decimals");
const DecimalTry = z.string().regex(/^\d+(\.\d{1,2})?$/, "decimal TRY amount, up to 2 decimals");

export const RegisterOptionsBody = z.object({ displayName: z.string().min(1).max(64) });
export const RegisterBody = z.object({
  displayName: z.string().min(1).max(64),
  email: z.string().email().optional(),
  challenge: z.string().min(16),
  registration: z.object({
    id: z.string().min(8),
    rawId: z.string().optional(),
    type: z.string().optional(),
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string().optional(),
      authenticatorData: z.string().optional(),
      publicKey: z.string().optional(),
      publicKeyAlgorithm: z.number().optional(),
      transports: z.array(z.string()).optional(),
    }),
  }),
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
export const BankTransferBody = z.object({ iban: z.string().min(10).max(40), reference: z.string().min(4).max(40), amountTry: DecimalTry });
export const OfframpBody = z.object({ amountUsdc: DecimalUsdc });
export const AmountBody = z.object({ amountUsdc: DecimalUsdc });
export const PolicyBody = z.object({ dailyCapUsdc: DecimalUsdc });
/** A cap change targets one on-chain window: the daily policy or the weekly one. */
export const CapBody = z
  .object({ dailyCapUsdc: DecimalUsdc.optional(), weeklyCapUsdc: DecimalUsdc.optional() })
  .refine((b) => (b.dailyCapUsdc === undefined) !== (b.weeklyCapUsdc === undefined), "send exactly one of dailyCapUsdc or weeklyCapUsdc");
export const PayBody = z.object({ url: z.string().url(), prefer: z.enum(["auto", "stellar", "evm"]).default("auto") });
export const RulesBody = z.object({
  weeklyCapUsdc: DecimalUsdc.nullable(),
  maxPerCallUsdc: DecimalUsdc.nullable(),
  allowedNetworks: z.array(z.enum(["stellar:testnet", "eip155:84532"])).min(1, "allow at least one chain"),
  /** Single payments above this amount need a human approval in the dashboard; omit/null = never. */
  approveAboveUsdc: DecimalUsdc.nullable().optional(),
});
export const AgentScopeEnum = z.enum(["read", "pay"]);
export const CreateTokenBody = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(AgentScopeEnum).min(1).default(["read", "pay"]),
  ttlDays: z.number().int().positive().max(365).nullable().optional(),
});
export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export const QuoteBody = z.object({
  url: z.string().url(),
  method: HttpMethod.default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  prefer: z.enum(["auto", "stellar", "evm"]).default("auto"),
});
export const PayBodyV2 = QuoteBody.extend({
  maxAmountUsdc: DecimalUsdc.optional(),
  approvalId: z.string().optional(),
});
export const RulesApprovalBody = z.object({ challenge: z.string().min(16), assertion: LoginVerifyBody.shape.assertion });
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

export const bodySchemas = { RegisterOptionsBody, RegisterBody, LoginOptionsBody, LoginVerifyBody, XdrBody, AuthorizeBuildBody, OnrampBody, BankTransferBody, OfframpBody, AmountBody, PolicyBody, CapBody, RulesBody, RulesApprovalBody, PayBody, PayBodyV2, QuoteBody, CreateTokenBody, EvmTransferBody, Event: EventSchema, Error: ErrorSchema };
