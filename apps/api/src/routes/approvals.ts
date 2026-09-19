import type { FastifyInstance } from "fastify";
import { events } from "@pera/core";
import { getApproval, listApprovals, resolveApproval, type ApprovalStatus } from "@pera/db";
import { requireOwner, requireScope } from "../auth";

/** Human-in-the-loop approvals for payments above the user's `approveAboveUsdc` rule (Stripe pattern). */
export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/approvals", async (req) => {
    const user = requireScope(req, "read");
    const status = (req.query as { status?: ApprovalStatus }).status;
    return listApprovals(user.id, status);
  });
  app.get("/approvals/:id", async (req, reply) => {
    const user = requireScope(req, "read");
    const a = await getApproval(user.id, (req.params as { id: string }).id);
    if (!a) return reply.status(404).send({ error: "approval not found", code: "NOT_FOUND" });
    return a;
  });
  for (const decision of ["approved", "denied"] as const) {
    app.post(`/approvals/:id/${decision === "approved" ? "approve" : "deny"}`, async (req, reply) => {
      const user = requireOwner(req);
      const a = await resolveApproval(user.id, (req.params as { id: string }).id, decision);
      if (!a) return reply.status(409).send({ error: "approval is not pending (already resolved or expired)", code: "NOT_PENDING" });
      events.emit({ type: "approval.resolved", userId: user.id, amountUsdc: a.amountUsdc, network: a.network as never, detail: { approvalId: a.id, url: a.url, decision } });
      return a;
    });
  }
}
