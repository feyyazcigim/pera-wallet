import type { FastifyInstance } from "fastify";
import { loadEnv } from "@pera/core";
import { consumeChallenge, createChallenge, createSession, deleteSession, getPasskey, getUser, touchPasskey } from "@pera/db";
import { verifyAssertion } from "@pera/passkey";
import { registerUser } from "../provisioning";
import { LoginOptionsBody, LoginVerifyBody, RegisterBody } from "../schemas";
import { meView } from "./me";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Browser flow: `kit.createWallet(app, name, { autoSubmit: false })` → post the passkey + deploy payload here.
   * The server submits the deploy (sponsor pays), verifies the passkey owns rule 0, provisions the rest.
   */
  app.post("/auth/register", async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const r = await registerUser(body);
    const session = await createSession(r.user.id);
    return reply.status(201).send({ token: session.token, expiresAt: session.expiresAt, ...(await meView(r.user)) });
  });

  app.post("/auth/login/options", async (req) => {
    const env = loadEnv();
    const { credentialId } = LoginOptionsBody.parse(req.body ?? {});
    const challenge = await createChallenge({ purpose: "login", credentialId });
    return {
      challenge,
      rpId: env.PASSKEY_RP_ID,
      userVerification: "required",
      allowCredentials: credentialId ? [{ id: credentialId, type: "public-key" }] : [],
      timeout: 60_000,
    };
  });

  app.post("/auth/login/verify", async (req, reply) => {
    const env = loadEnv();
    const { challenge, assertion } = LoginVerifyBody.parse(req.body);
    const ch = await consumeChallenge(challenge, "login");
    if (!ch) return reply.status(401).send({ error: "challenge expired or unknown", code: "BAD_CHALLENGE" });
    const passkey = await getPasskey(assertion.id);
    if (!passkey) return reply.status(401).send({ error: "unknown passkey", code: "UNKNOWN_CREDENTIAL" });
    await verifyAssertion({
      assertion,
      publicKey: passkey.publicKey,
      expectedChallenge: challenge,
      expectedOrigins: env.PASSKEY_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
      expectedRpId: env.PASSKEY_RP_ID,
      requireUserVerification: false,
    }).catch((err: Error) => {
      throw Object.assign(new Error(`passkey verification failed: ${err.message}`), { statusCode: 401, code: "BAD_ASSERTION" });
    });
    await touchPasskey(passkey.credentialId);
    const user = await getUser(passkey.userId);
    if (!user) return reply.status(401).send({ error: "user missing", code: "UNKNOWN_USER" });
    const session = await createSession(user.id);
    return { token: session.token, expiresAt: session.expiresAt, ...(await meView(user)) };
  });

  app.post("/auth/logout", async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ps_")) await deleteSession(header.slice(7));
    return { ok: true };
  });
}
