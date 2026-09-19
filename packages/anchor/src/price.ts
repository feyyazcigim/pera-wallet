import { USDC_CODE, USDC_ISSUER } from "@pera/core";
import { getAuthed } from "./client";

export interface TryUsdcPrice {
  /** TRY per 1 USDC when buying USDC with TRY. */
  tryPerUsdc: string;
  sellAmountTry: string;
  buyAmountUsdc: string;
}

/** SEP-38 indicative price (TRY → USDC). Optional; used by `/status`. */
export async function getTryUsdcPrice(accountSecret: string, sellAmountTry = "1000"): Promise<TryUsdcPrice | null> {
  try {
    const { anchor, authToken } = await getAuthed(accountSecret);
    const res = await anchor.sep38(authToken).prices({ sellAsset: "iso4217:TRY", sellAmount: sellAmountTry });
    const usdc = res.buy_assets.find((a) => a.asset === `stellar:${USDC_CODE}:${USDC_ISSUER}`);
    if (!usdc) return null;
    const price = Number(usdc.price);
    return { tryPerUsdc: usdc.price, sellAmountTry, buyAmountUsdc: (Number(sellAmountTry) / price).toFixed(2) };
  } catch {
    return null;
  }
}
