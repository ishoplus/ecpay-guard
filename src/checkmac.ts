import { createHash, timingSafeEqual } from "node:crypto";

export type Params = Record<string, string>;

/**
 * 綠界要求的 URL 編碼（官方「URLEncode 轉換表」的 .NET 欄）。
 * 和 encodeURIComponent 的差別只有三個：空白是 +、~ 要編成 %7e、' 要編成 %27。
 * ! * ( ) - _ . 保持原樣，兩邊一致。
 */
function ecpayEncode(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, "+").replace(/~/g, "%7e").replace(/'/g, "%27");
}

/**
 * 計算 CheckMacValue：參數依名稱排序（不分大小寫）→ 前接 HashKey、後接 HashIV
 * → URL 編碼 → 轉小寫 → SHA256 → 轉大寫。CheckMacValue 本身不參與計算。
 */
export function computeCheckMacValue(params: Params, hashKey: string, hashIV: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue")
    .sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const raw = `HashKey=${hashKey}&${keys.map((k) => `${k}=${params[k]}`).join("&")}&HashIV=${hashIV}`;
  return createHash("sha256").update(ecpayEncode(raw).toLowerCase()).digest("hex").toUpperCase();
}

/** 驗證通知裡的 CheckMacValue。用固定時間比較，避免從回應時間猜出正確值。 */
export function verifyCheckMacValue(params: Params, hashKey: string, hashIV: string): boolean {
  const got = params.CheckMacValue;
  if (!got) return false;
  const want = Buffer.from(computeCheckMacValue(params, hashKey, hashIV));
  const have = Buffer.from(got.toUpperCase());
  return want.length === have.length && timingSafeEqual(want, have);
}
