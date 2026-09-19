/**
 * Per-user wallet context. Every package function that acts for a user takes this object instead
 * of reading a global owner/agent secret from the environment.
 *
 * - The smart account is owned by the user's passkey (never on the server).
 * - `treasury` is a custodial, sponsor-created G-account: receives anchor USDC, is the DeFindex
 *   depositor and refills the smart account.
 * - `agent` is the custodial Ed25519 session key: restricted signer on the smart account (cap) and
 *   the classic x402 float account.
 */
export interface UserWalletContext {
  userId: string;
  smartAccountId: string;
  credentialId: string;
  treasurySecret: string;
  treasuryPub: string;
  agentSecret: string;
  agentPub: string;
  agentRuleId?: number;
  dailyCapUsdc: string;
  evm?: { provider: string; walletId?: string; address: string };
}
