/** Stellar testnet network parameters. */
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

/** CAIP-2 network identifiers used by x402. */
export const STELLAR_CAIP2 = "stellar:testnet" as const;
export const BASE_SEPOLIA_CAIP2 = "eip155:84532" as const;
export type Caip2Network = typeof STELLAR_CAIP2 | typeof BASE_SEPOLIA_CAIP2;

/**
 * Circle testnet USDC on Stellar. The TR mock anchor pays out this exact asset and the
 * CCTP TokenMessengerMinter burns it. Verified live on 2026-09-19 (stellar.expert).
 */
export const USDC_CODE = "USDC";
export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const USDC_DECIMALS = 7;

/** TR mock anchor (SEP-1/10/12/38/6). Treasury verified from /health. */
export const ANCHOR = {
  homeDomain: "tr-mock-anchor.fly.dev",
  baseUrl: "https://tr-mock-anchor.fly.dev",
  treasury: "GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6",
} as const;

/**
 * OpenZeppelin smart account artefacts on testnet, from smart-account-kit
 * docs/deployments-protocol-27-2026-07-09.md.
 */
export const SMART_ACCOUNT = {
  accountWasmHash: "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifier: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  ed25519Verifier: "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4",
  spendingLimitPolicy: "CABXBYJNZ7IUW4G3D6BND5YCAQF3ASSDMDAOKQQ63UYFSO7WUU2TIP5G",
  /**
   * Second instance of the same spending_limit wasm (scripts/deploy-weekly-policy.ts). A rule's policies are keyed
   * by contract address and each instance keeps one window per (account, rule), so the weekly window needs its own.
   */
  weeklySpendingLimitPolicy: "CDPNKQFBURV7ZAYWXQTVOWH2BXNCIRZRYTFSQFYG7BTN7EV5QRTUHJ3D",
  thresholdPolicy: "CB3FATQKCIRIQOCYRUPCQ2KREQ7T4RPKS7EAEOZWPEPUKWEDRVROBCEG",
  /** ~5 s ledgers → 17 280 per day; the spending_limit period is expressed in ledgers. */
  ledgersPerDay: 17_280,
  ledgersPerWeek: 120_960,
  /** spending_limit policy error codes (OpenZeppelin stellar-contracts). */
  errors: { SpendingLimitExceeded: 3221, NotAllowed: 3223 },
} as const;

/** Circle CCTP V2 — Stellar testnet (domain 27) → Base Sepolia (domain 6). */
export const CCTP = {
  stellarDomain: 27,
  baseSepoliaDomain: 6,
  tokenMessengerMinter: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  messageTransmitter: "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
  forwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  irisUrl: "https://iris-api-sandbox.circle.com",
  /** Stellar is not a Fast Transfer source; standard finality (2000) is attested within seconds anyway. */
  minFinalityThreshold: 2000,
} as const;

export const BASE_SEPOLIA = {
  chainId: 84532,
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  usdcDecimals: 6,
} as const;

export const DEFINDEX = {
  apiUrl: "https://api.defindex.io",
  /** testnet factory from defindex-io/stellar-contracts public/testnet.contracts.json (may be redeployed). */
  factory: "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32",
} as const;

export const X402 = {
  defaultFacilitator: "https://x402.org/facilitator",
  ozFacilitatorTestnet: "https://channels.openzeppelin.com/x402/testnet",
} as const;
