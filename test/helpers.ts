import { computeCheckMacValue, type Params } from "../src/index.js";

// 綠界文件公開的測試特店（檢查碼範例用的就是這組）
export const MERCHANT_ID = "3002607";
export const HASH_KEY = "pwFHCqoQZGmho4w6";
export const HASH_IV = "EkRm7iFT261dpevs";

export function sign(p: Params): Params {
  return { ...p, CheckMacValue: computeCheckMacValue(p, HASH_KEY, HASH_IV) };
}

/** 信用卡付款成功的 ReturnURL 通知 */
export function paid(over: Params = {}): Params {
  return sign({
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: "order001",
    StoreID: "",
    RtnCode: "1",
    RtnMsg: "交易成功",
    TradeNo: "2310101234567890",
    TradeAmt: "990",
    PaymentDate: "2026/10/10 12:00:00",
    PaymentType: "Credit_CreditCard",
    PaymentTypeChargeFee: "25",
    TradeDate: "2026/10/10 11:59:00",
    SimulatePaid: "0",
    CustomField1: "",
    CustomField2: "",
    CustomField3: "",
    CustomField4: "",
    ...over,
  });
}

/** ATM 取號成功的 PaymentInfoURL 通知 */
export function atmIssued(over: Params = {}): Params {
  return sign({
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: "order002",
    StoreID: "",
    RtnCode: "2",
    RtnMsg: "Get VirtualAccount Succeeded",
    TradeNo: "2310101234567891",
    TradeAmt: "1490",
    PaymentType: "ATM_TAISHIN",
    TradeDate: "2026/10/10 12:00:00",
    BankCode: "812",
    vAccount: "9103522175887271",
    ExpireDate: "2026/10/13",
    CustomField1: "",
    CustomField2: "",
    CustomField3: "",
    CustomField4: "",
    ...over,
  });
}
