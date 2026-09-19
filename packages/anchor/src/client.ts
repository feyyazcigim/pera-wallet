import walletSdk from "@stellar/typescript-wallet-sdk";
import type { Anchor, Types } from "@stellar/typescript-wallet-sdk";

// The wallet SDK ships a CommonJS bundle; named ESM imports are not detectable, so destructure the default.
const { Wallet, SigningKeypair } = walletSdk as unknown as typeof import("@stellar/typescript-wallet-sdk");

/** Public key for a secret, via the wallet SDK's own stellar-sdk copy (keeps SDK versions apart). */
export function publicKeyOf(secret: string): string {
  return SigningKeypair.fromSecret(secret).publicKey;
}
import { ANCHOR, childLogger } from "@pera/core";

const log = childLogger("anchor");

export interface AnchorSession {
  anchor: Anchor;
  authToken: Types.AuthToken;
  account: string;
  createdAt: number;
}

const SESSION_TTL_MS = 5 * 60_000;
const sessions = new Map<string, AnchorSession>();

let wallet: InstanceType<typeof Wallet> | undefined;
function getWallet(): InstanceType<typeof Wallet> {
  wallet ??= Wallet.TestNet();
  return wallet;
}

export function getAnchor(): Anchor {
  return getWallet().anchor({ homeDomain: ANCHOR.homeDomain });
}

/**
 * SEP-10 authenticate + SEP-12 (auto-approved KYC) for the given account. Sessions are cached
 * for five minutes; KYC is (re)submitted on every fresh session so a sandbox reset never matters.
 */
export async function getAuthed(secret: string): Promise<AnchorSession> {
  const kp = SigningKeypair.fromSecret(secret);
  const cached = sessions.get(kp.publicKey);
  if (cached && Date.now() - cached.createdAt < SESSION_TTL_MS) return cached;

  const anchor = getAnchor();
  const sep10 = await anchor.sep10();
  const authToken = await sep10.authenticate({ accountKp: kp });
  const sep12 = await anchor.sep12(authToken);
  const kyc = await sep12.add({
    sep9Info: { first_name: "Pera", last_name: "Agent", email_address: "agent@pera.local" },
  });
  log.debug({ account: kp.publicKey, customerId: kyc.id }, "anchor session ready");

  const session: AnchorSession = { anchor, authToken, account: kp.publicKey, createdAt: Date.now() };
  sessions.set(kp.publicKey, session);
  return session;
}

export async function anchorInfo() {
  const anchor = getAnchor();
  const toml = await anchor.sep1();
  return {
    homeDomain: ANCHOR.homeDomain,
    signingKey: toml.signingKey,
    transferServer: toml.transferServer,
    webAuthEndpoint: toml.webAuthEndpoint,
    kycServer: toml.kycServer,
    anchorQuoteServer: toml.anchorQuoteServer,
  };
}
