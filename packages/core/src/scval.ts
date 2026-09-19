import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export const scAddress = (addr: string): xdr.ScVal => new Address(addr).toScVal();
export const scI128 = (n: bigint): xdr.ScVal => nativeToScVal(n, { type: "i128" });
export const scU32 = (n: number): xdr.ScVal => nativeToScVal(n, { type: "u32" });
export const scU64 = (n: bigint | number): xdr.ScVal => nativeToScVal(n, { type: "u64" });
export const scSymbol = (s: string): xdr.ScVal => xdr.ScVal.scvSymbol(s);
export const scString = (s: string): xdr.ScVal => xdr.ScVal.scvString(s);
export const scBytes = (b: Uint8Array): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.from(b));
export function scBytes32(b: Uint8Array): xdr.ScVal {
  if (b.length !== 32) throw new Error(`expected 32 bytes, got ${b.length}`);
  return scBytes(b);
}
