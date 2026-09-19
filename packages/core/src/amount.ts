/**
 * Decimal ↔ integer-unit conversions done entirely with BigInt.
 * Stellar USDC has 7 decimals ("stroops"); CCTP / EVM USDC has 6 ("micro").
 */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

export function parseDecimal(dec: string, decimals: number): bigint {
  const s = dec.trim();
  if (!DECIMAL_RE.test(s)) throw new Error(`invalid decimal amount: "${dec}"`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(`amount "${dec}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function formatDecimal(units: bigint | string | number, decimals: number): string {
  let n = BigInt(units);
  const neg = n < 0n;
  if (neg) n = -n;
  const s = n.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const usdcToStroops = (dec: string): bigint => parseDecimal(dec, 7);
export const stroopsToUsdc = (s: bigint | string | number): string => formatDecimal(s, 7);
export const usdcToMicro = (dec: string): bigint => parseDecimal(dec, 6);
export const microToUsdc = (m: bigint | string | number): string => formatDecimal(m, 6);

/** 7-dp stroops → 6-dp micro USDC. Throws unless the amount is representable. */
export function stroopsToMicro(stroops: bigint): bigint {
  if (stroops % 10n !== 0n) throw new Error("stroop amount is not a multiple of 10 (not representable in 6 dp)");
  return stroops / 10n;
}

/** CCTP messages carry 6-dp amounts: drop the 7th decimal. */
export const roundDownToCctp = (stroops: bigint): bigint => stroops - (stroops % 10n);

export const addUsdc = (a: string, b: string): string => stroopsToUsdc(usdcToStroops(a) + usdcToStroops(b));
export function subUsdc(a: string, b: string): string {
  const r = usdcToStroops(a) - usdcToStroops(b);
  if (r < 0n) throw new Error(`negative result: ${a} - ${b}`);
  return stroopsToUsdc(r);
}
export function cmpUsdc(a: string, b: string): -1 | 0 | 1 {
  const x = usdcToStroops(a);
  const y = usdcToStroops(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export const maxUsdc = (a: string, b: string): string => (cmpUsdc(a, b) >= 0 ? a : b);
export const minUsdc = (a: string, b: string): string => (cmpUsdc(a, b) <= 0 ? a : b);
export const isZeroUsdc = (a: string): boolean => usdcToStroops(a) === 0n;

/**
 * smart-account-kit's `transfer()` takes a whole-unit JS number and scales it by the
 * token's decimals itself. This is the only place a float is produced.
 */
export function usdcToKitNumber(dec: string): number {
  const stroops = usdcToStroops(dec);
  if (stroops >= 10_000_000n * 1_000_000_000n) throw new Error("amount too large for a safe number");
  return Number(stroops) / 1e7;
}
