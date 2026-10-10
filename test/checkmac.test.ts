import { describe, expect, it } from "vitest";
import { computeCheckMacValue, verifyCheckMacValue } from "../src/index.js";
import { HASH_IV, HASH_KEY, sign } from "./helpers.js";

describe("CheckMacValue", () => {
  it("和綠界文件「檢查碼機制」的範例值完全一致", () => {
    const params = {
      TradeDesc: "促銷方案",
      PaymentType: "aio",
      MerchantTradeDate: "2023/03/12 15:30:23",
      MerchantTradeNo: "ecpay20230312153023",
      MerchantID: "3002607",
      ReturnURL: "https://www.ecpay.com.tw/receive.php",
      ItemName: "Apple iphone 15",
      TotalAmount: "30000",
      ChoosePayment: "ALL",
      EncryptType: "1",
    };
    expect(computeCheckMacValue(params, HASH_KEY, HASH_IV)).toBe(
      "6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840",
    );
  });

  it("CheckMacValue 本身不參與計算", () => {
    const p = { A: "1", B: "2" };
    expect(computeCheckMacValue({ ...p, CheckMacValue: "x" }, HASH_KEY, HASH_IV)).toBe(
      computeCheckMacValue(p, HASH_KEY, HASH_IV),
    );
  });

  it("排序不分大小寫：vAccount 排在 TradeNo 之後", () => {
    const a = computeCheckMacValue({ vAccount: "1", TradeNo: "2" }, HASH_KEY, HASH_IV);
    const b = computeCheckMacValue({ TradeNo: "2", vAccount: "1" }, HASH_KEY, HASH_IV);
    expect(a).toBe(b);
  });

  it("~ 與 ' 照綠界轉換表編碼，結果和 encodeURIComponent 不同", () => {
    // 若 ~ 沒編成 %7e，兩個值會一樣
    const tilde = computeCheckMacValue({ ItemName: "a~b" }, HASH_KEY, HASH_IV);
    const encoded = computeCheckMacValue({ ItemName: "a%7eb" }, HASH_KEY, HASH_IV);
    expect(tilde).not.toBe(encoded); // %7e 會再被編成 %257e
    expect(computeCheckMacValue({ ItemName: "it's" }, HASH_KEY, HASH_IV)).toMatch(/^[0-9A-F]{64}$/);
  });

  it("驗證：正確的通過；改一個字、缺檢查碼、小寫檢查碼的處理", () => {
    const p = sign({ MerchantID: "3002607", RtnCode: "1" });
    expect(verifyCheckMacValue(p, HASH_KEY, HASH_IV)).toBe(true);
    expect(verifyCheckMacValue({ ...p, RtnCode: "2" }, HASH_KEY, HASH_IV)).toBe(false);
    expect(verifyCheckMacValue({ MerchantID: "3002607" }, HASH_KEY, HASH_IV)).toBe(false);
    expect(verifyCheckMacValue({ ...p, CheckMacValue: p.CheckMacValue!.toLowerCase() }, HASH_KEY, HASH_IV)).toBe(true);
    expect(verifyCheckMacValue({ ...p, CheckMacValue: "ABC" }, HASH_KEY, HASH_IV)).toBe(false);
  });
});
