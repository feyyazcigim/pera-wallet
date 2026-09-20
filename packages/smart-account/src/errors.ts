import { ContractError, decodeContractError, SmartAccountError as KitError } from "smart-account-kit";
import { decodeContractErrorCode, SMART_ACCOUNT } from "@pera/core";

export interface DecodedError {
  code: number | null;
  name?: string;
  family?: string;
  message: string;
}

/** Normalises any kit / RPC error into `{ code, name, message }` (e.g. 3221 SpendingLimitExceeded). */
export function decodeKitError(err: unknown): DecodedError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ContractError) {
    return { code: err.contractCode, name: err.contractErrorName, family: err.family, message };
  }
  const decoded = decodeContractError(err) ?? decodeContractError(message);
  if (decoded) return { code: decoded.contractCode, name: decoded.contractErrorName, family: decoded.family, message };
  const cause = err instanceof KitError ? err.cause : undefined;
  const code = decodeContractErrorCode(message) ?? (cause ? decodeContractErrorCode(cause.message) : null);
  const name = code === SMART_ACCOUNT.errors.SpendingLimitExceeded ? "SpendingLimitExceeded" : code === SMART_ACCOUNT.errors.NotAllowed ? "NotAllowed" : undefined;
  return { code, name, message };
}

export class SpendingCapExceededError extends Error {
  readonly code = SMART_ACCOUNT.errors.SpendingLimitExceeded;
  readonly errorName = "SpendingLimitExceeded";
  constructor(
    readonly attemptedUsdc: string,
    readonly dailyCapUsdc: string,
    readonly raw: string,
    /** Which on-chain window said no. Both are spending_limit instances, so both answer with #3221. */
    readonly window: "daily" | "weekly" = "daily",
    readonly weeklyCapUsdc: string | null = null,
  ) {
    super(
      window === "weekly"
        ? `spending cap exceeded: attempted ${attemptedUsdc} USDC against a ${weeklyCapUsdc} USDC rolling weekly cap (policy error #${SMART_ACCOUNT.errors.SpendingLimitExceeded} SpendingLimitExceeded)`
        : `spending cap exceeded: attempted ${attemptedUsdc} USDC against a ${dailyCapUsdc} USDC rolling daily cap (policy error #${SMART_ACCOUNT.errors.SpendingLimitExceeded} SpendingLimitExceeded)`,
    );
    this.name = "SpendingCapExceededError";
  }
}

export class SmartAccountOpError extends Error {
  constructor(
    message: string,
    readonly decoded: DecodedError,
  ) {
    super(message);
    this.name = "SmartAccountOpError";
  }
}
