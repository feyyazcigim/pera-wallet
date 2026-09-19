import {
  Account,
  Asset,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { stroopsToUsdc, usdcToStroops } from "./amount";
import { FRIENDBOT_URL, HORIZON_URL, NETWORK_PASSPHRASE, RPC_URL, USDC_CODE, USDC_ISSUER, USDC_SAC } from "./constants";
import { stellarTxUrl } from "./explorer";
import { childLogger } from "./logger";
import { scAddress, scI128 } from "./scval";

const log = childLogger("stellar");

let rpcServer: rpc.Server | undefined;
let horizonServer: Horizon.Server | undefined;

export function getRpc(): rpc.Server {
  rpcServer ??= new rpc.Server(RPC_URL);
  return rpcServer;
}

export function getHorizon(): Horizon.Server {
  horizonServer ??= new Horizon.Server(HORIZON_URL);
  return horizonServer;
}

export const usdcAsset = (): Asset => new Asset(USDC_CODE, USDC_ISSUER);

export interface TxResult {
  hash: string;
  explorerUrl: string;
  ledger: number;
  returnValue?: unknown;
}

export class ContractInvokeError extends Error {
  constructor(
    message: string,
    readonly phase: "simulate" | "send" | "result",
    readonly code: number | null,
    readonly raw: string,
  ) {
    super(message);
    this.name = "ContractInvokeError";
  }
}

/** Extracts `#3221` from `Error(Contract, #3221)` style host errors. */
export function decodeContractErrorCode(message: string): number | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  return m ? Number(m[1]) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Accounts, balances, trustlines
// ---------------------------------------------------------------------------

export interface AccountBalances {
  exists: boolean;
  xlm: string;
  usdc: string;
  hasUsdcTrustline: boolean;
}

export async function getBalances(publicKey: string): Promise<AccountBalances> {
  try {
    const acc = await getHorizon().loadAccount(publicKey);
    let xlm = "0";
    let usdc = "0";
    let hasUsdcTrustline = false;
    for (const b of acc.balances) {
      if (b.asset_type === "native") xlm = b.balance;
      else if ("asset_code" in b && b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER) {
        usdc = b.balance;
        hasUsdcTrustline = true;
      }
    }
    return { exists: true, xlm, usdc: stroopsToUsdc(usdcToStroops(usdc)), hasUsdcTrustline };
  } catch (err: unknown) {
    if (isNotFound(err)) return { exists: false, xlm: "0", usdc: "0", hasUsdcTrustline: false };
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { response?: { status?: number }; name?: string };
  return e?.response?.status === 404 || e?.name === "NotFoundError";
}

export async function friendbot(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (res.ok) return;
  const body = await res.text();
  if (res.status === 400 && /createAccountAlreadyExist|already funded/i.test(body)) return;
  throw new Error(`friendbot failed (${res.status}): ${body.slice(0, 300)}`);
}

/** Creates the account via friendbot when it does not exist yet. */
export async function ensureFunded(publicKey: string): Promise<{ funded: boolean }> {
  const bal = await getBalances(publicKey);
  if (bal.exists) return { funded: false };
  log.info({ publicKey }, "funding via friendbot");
  await friendbot(publicKey);
  for (let i = 0; i < 10; i++) {
    if ((await getBalances(publicKey)).exists) return { funded: true };
    await sleep(1500);
  }
  throw new Error(`account ${publicKey} still missing after friendbot`);
}

/** Adds the USDC trustline (self-paid, classic tx) if missing. */
export async function ensureUsdcTrustline(secret: string): Promise<{ created: boolean; txHash?: string }> {
  const kp = Keypair.fromSecret(secret);
  const bal = await getBalances(kp.publicKey());
  if (bal.hasUsdcTrustline) return { created: false };
  const horizon = getHorizon();
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: usdcAsset() }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  log.info({ account: kp.publicKey(), hash: res.hash }, "USDC trustline created");
  return { created: true, txHash: res.hash };
}

/** Classic USDC payment (used for the anchor off-ramp: destination + id memo). */
export async function sendClassicPayment(p: {
  sourceSecret: string;
  destination: string;
  amountUsdc: string;
  memoId?: string;
  memoText?: string;
}): Promise<TxResult> {
  const kp = Keypair.fromSecret(p.sourceSecret);
  const horizon = getHorizon();
  const account = await horizon.loadAccount(kp.publicKey());
  const builder = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.payment({ destination: p.destination, asset: usdcAsset(), amount: stroopsToUsdc(usdcToStroops(p.amountUsdc)) }))
    .setTimeout(60);
  if (p.memoId) builder.addMemo(Memo.id(p.memoId));
  else if (p.memoText) builder.addMemo(Memo.text(p.memoText));
  const tx = builder.build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  return { hash: res.hash, explorerUrl: stellarTxUrl(res.hash), ledger: res.ledger };
}

// ---------------------------------------------------------------------------
// Soroban helpers
// ---------------------------------------------------------------------------

export async function getLatestLedger(): Promise<number> {
  return (await getRpc().getLatestLedger()).sequence;
}

/** Simulation-only read of a contract function. */
export async function readContract<T = unknown>(p: {
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
  sourcePublicKey?: string;
}): Promise<T> {
  // Any valid account id works as a simulation source; use the contract-agnostic zero-sequence account.
  const source = new Account(p.sourcePublicKey ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(p.contractId).call(p.method, ...(p.args ?? [])))
    .setTimeout(30)
    .build();
  const sim = await getRpc().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new ContractInvokeError(`read ${p.method} failed: ${sim.error}`, "simulate", decodeContractErrorCode(sim.error), sim.error);
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`read ${p.method}: empty simulation result`);
  return scValToNative(sim.result.retval) as T;
}

/** USDC balance of any G- or C-address via the SAC `balance` function. */
export async function getContractUsdcBalance(address: string): Promise<string> {
  const raw = await readContract<bigint>({ contractId: USDC_SAC, method: "balance", args: [scAddress(address)] });
  return stroopsToUsdc(BigInt(raw));
}

export interface InvokeParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** Transaction source; its signature satisfies `require_auth` for the source address. */
  sourceSecret: string;
  /** Optional fee payer: the inner tx is wrapped in a fee-bump signed by this key. */
  sponsorSecret?: string;
  timeoutSec?: number;
}

/**
 * Build → simulate → assemble → sign → (fee-bump) → send → poll. Throws `ContractInvokeError`
 * with the decoded contract error code when simulation or execution fails.
 */
export async function invokeContract(p: InvokeParams): Promise<TxResult> {
  const source = Keypair.fromSecret(p.sourceSecret);
  const server = getRpc();
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(p.contractId).call(p.method, ...p.args))
    .setTimeout(p.timeoutSec ?? 60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new ContractInvokeError(`${p.method} simulation failed: ${sim.error}`, "simulate", decodeContractErrorCode(sim.error), sim.error);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(source);
  return submitPrepared(prepared, p.sponsorSecret);
}

/** Signs an externally built (already simulated) transaction XDR and submits it, optionally fee-bumped. */
export async function submitSignedXdr(p: { xdr: string; signerSecrets: string[]; sponsorSecret?: string }): Promise<TxResult> {
  const tx = TransactionBuilder.fromXDR(p.xdr, NETWORK_PASSPHRASE);
  if (tx instanceof FeeBumpTransaction) throw new Error("expected an inner transaction, got a fee bump");
  for (const s of p.signerSecrets) tx.sign(Keypair.fromSecret(s));
  return submitPrepared(tx, p.sponsorSecret);
}

async function submitPrepared(prepared: Transaction, sponsorSecret?: string): Promise<TxResult> {
  const server = getRpc();
  let toSend: Transaction | FeeBumpTransaction = prepared;
  if (sponsorSecret) {
    const sponsor = Keypair.fromSecret(sponsorSecret);
    if (sponsor.publicKey() !== prepared.source) {
      const fb = TransactionBuilder.buildFeeBumpTransaction(sponsor, prepared.fee, prepared, NETWORK_PASSPHRASE);
      fb.sign(sponsor);
      toSend = fb;
    }
  }
  const sent = await server.sendTransaction(toSend);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    const raw = sent.errorResult ? sent.errorResult.toXDR("base64") : sent.status;
    const detail = sent.errorResult ? describeTxResult(sent.errorResult) : sent.status;
    throw new ContractInvokeError(`send failed: ${detail}`, "send", decodeContractErrorCode(detail), raw);
  }
  const res = await waitForTx(sent.hash);
  return {
    hash: sent.hash,
    explorerUrl: stellarTxUrl(sent.hash),
    ledger: res.ledger,
    returnValue: res.returnValue ? scValToNative(res.returnValue) : undefined,
  };
}

function describeTxResult(result: xdr.TransactionResult): string {
  try {
    return result.result().switch().name;
  } catch {
    return "unknown";
  }
}

export async function waitForTx(hash: string, timeoutMs = 90_000): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getRpc();
  const started = Date.now();
  for (;;) {
    const res = await server.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return res;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      const raw = res.resultXdr.toXDR("base64");
      let detail = "transaction failed on-chain";
      try {
        detail = `${detail}: ${res.resultXdr.result().switch().name}`;
        // Contract errors surface in the diagnostic events of the meta; expose the raw XDR for the caller.
      } catch {
        /* keep generic */
      }
      throw new ContractInvokeError(detail, "result", null, raw);
    }
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for tx ${hash}`);
    await sleep(2000);
  }
}

/** SAC `transfer(from, to, amount)` — used to move USDC from the owner G-account into the smart account. */
export async function sacTransfer(p: { fromSecret: string; to: string; amountUsdc: string; sponsorSecret?: string }): Promise<TxResult> {
  const from = Keypair.fromSecret(p.fromSecret).publicKey();
  return invokeContract({
    contractId: USDC_SAC,
    method: "transfer",
    args: [scAddress(from), scAddress(p.to), scI128(usdcToStroops(p.amountUsdc))],
    sourceSecret: p.fromSecret,
    sponsorSecret: p.sponsorSecret,
  });
}
