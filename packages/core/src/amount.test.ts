import { describe, expect, it } from "vitest";
import {
  addUsdc,
  cmpUsdc,
  formatDecimal,
  microToUsdc,
  parseDecimal,
  roundDownToCctp,
  stroopsToMicro,
  stroopsToUsdc,
  subUsdc,
  usdcToKitNumber,
  usdcToMicro,
  usdcToStroops,
} from "./amount";

describe("amount", () => {
  it("parses and formats 7-dp amounts", () => {
    expect(usdcToStroops("1")).toBe(10_000_000n);
    expect(usdcToStroops("0.0000001")).toBe(1n);
    expect(usdcToStroops("12.5")).toBe(125_000_000n);
    expect(stroopsToUsdc(125_000_000n)).toBe("12.5");
    expect(stroopsToUsdc(1n)).toBe("0.0000001");
    expect(stroopsToUsdc(0n)).toBe("0");
    expect(stroopsToUsdc("10000000")).toBe("1");
  });

  it("rejects malformed input", () => {
    expect(() => parseDecimal("-1", 7)).toThrow();
    expect(() => parseDecimal("1.12345678", 7)).toThrow();
    expect(() => parseDecimal("abc", 7)).toThrow();
    expect(() => parseDecimal("", 7)).toThrow();
  });

  it("converts between 7 dp and 6 dp", () => {
    expect(usdcToMicro("1")).toBe(1_000_000n);
    expect(microToUsdc(1_500_000n)).toBe("1.5");
    expect(stroopsToMicro(10_000_000n)).toBe(1_000_000n);
    expect(() => stroopsToMicro(1n)).toThrow();
    expect(roundDownToCctp(12_345_678n)).toBe(12_345_670n);
    expect(formatDecimal(-5n, 1)).toBe("-0.5");
  });

  it("does decimal arithmetic without floats", () => {
    expect(addUsdc("0.1", "0.2")).toBe("0.3");
    expect(subUsdc("1", "0.9999999")).toBe("0.0000001");
    expect(() => subUsdc("1", "2")).toThrow();
    expect(cmpUsdc("1.0", "1")).toBe(0);
    expect(cmpUsdc("0.5", "1")).toBe(-1);
    expect(cmpUsdc("2", "1")).toBe(1);
  });

  it("produces the kit's whole-unit number", () => {
    expect(usdcToKitNumber("3")).toBe(3);
    expect(usdcToKitNumber("0.01")).toBe(0.01);
  });
});
