import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ContractInvokeError, childLogger } from "@pera/core";
import { SmartAccountOpError, SpendingCapExceededError } from "@pera/smart-account";
import { ApprovalRequiredError, PaywallError, RuleViolationError } from "@pera/x402-router";

const log = childLogger("api.errors");

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string | number }, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: "invalid request body", code: "BAD_REQUEST", detail: err.issues });
    if (err instanceof SpendingCapExceededError) {
      return reply.status(409).send({ error: err.message, code: "SPENDING_CAP_EXCEEDED", errorCode: err.code, detail: { attemptedUsdc: err.attemptedUsdc, dailyCapUsdc: err.dailyCapUsdc, errorName: err.errorName, raw: err.raw } });
    }
    if (err instanceof RuleViolationError) return reply.status(409).send({ error: err.message, code: "RULE_VIOLATION", detail: { rule: err.rule, ...err.detail } });
    if (err instanceof ApprovalRequiredError) {
      return reply.status(409).send({ error: err.message, code: "APPROVAL_REQUIRED", detail: { approvalId: err.approvalId, approveUrl: err.approveUrl, amountUsdc: err.amountUsdc, network: err.network, expiresAt: err.expiresAt, url: err.url } });
    }
    if (err instanceof SmartAccountOpError) return reply.status(502).send({ error: err.message, code: "SMART_ACCOUNT_ERROR", errorCode: err.decoded.code ?? undefined, detail: err.decoded });
    if (err instanceof ContractInvokeError) return reply.status(502).send({ error: err.message, code: "CONTRACT_ERROR", errorCode: err.code ?? undefined, detail: { phase: err.phase, raw: err.raw } });
    if (err instanceof PaywallError) return reply.status(502).send({ error: err.message, code: "PAYWALL_ERROR", detail: { status: err.status, body: err.body } });
    const status = err.statusCode ?? 500;
    // a route that sets its own statusCode (e.g. 503 YIELD_UNAVAILABLE) made a decision; only log what nobody anticipated
    if (status >= 500 && !err.statusCode) log.error({ err }, "unhandled error");
    const extra = (err as { scope?: string }).scope ? { detail: { scope: (err as { scope?: string }).scope } } : {};
    return reply.status(status).send({ error: err.message ?? "internal error", code: (typeof err.code === "string" && err.code) || (status >= 500 ? "INTERNAL" : "ERROR"), ...extra });
  });
}
