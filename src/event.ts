import type { Params } from "./checkmac.js";

export type EventType =
  | "payment.succeeded" // 付款成功（ReturnURL，RtnCode=1）
  | "payment.failed" // 付款失敗（ReturnURL，RtnCode≠1）
  | "payment.simulated" // 廠商後台按的「模擬付款」：買家沒付錢、綠界不會撥款
  | "code.issued" // ATM / 超商代碼 / 條碼取號成功，買家還沒付
  | "code.failed"; // 取號失敗

export type Source = "return" | "payment-info";
export type Method = "credit" | "atm" | "webatm" | "cvs" | "barcode" | "other";

export interface PaymentCode {
  bankCode?: string; // ATM 銀行代碼
  vAccount?: string; // ATM 虛擬帳號
  paymentNo?: string; // 超商繳費代碼
  barcodes?: [string, string, string]; // 條碼三段
  expireDate: string; // 繳費期限
}

export interface GuardEvent {
  /** 去重用的唯一鍵：來源 + 特店訂單編號 + 綠界交易編號 + RtnCode */
  key: string;
  type: EventType;
  source: Source;
  /** 你的訂單編號（MerchantTradeNo） */
  orderId: string;
  /** 綠界交易編號（TradeNo），請和訂單一起存 */
  tradeNo: string;
  amount: number;
  paymentType: string;
  method: Method;
  simulated: boolean;
  rtnCode: string;
  rtnMsg: string;
  paidAt?: string;
  code?: PaymentCode;
  customFields: [string, string, string, string];
  /** 綠界送來的原始參數 */
  raw: Params;
}

export class UnsupportedNotificationError extends Error {}

function methodOf(paymentType: string): Method {
  const p = paymentType.toUpperCase();
  if (p.startsWith("CREDIT")) return "credit";
  if (p.startsWith("WEBATM")) return "webatm";
  if (p.startsWith("ATM")) return "atm";
  if (p.startsWith("CVS")) return "cvs";
  if (p.startsWith("BARCODE")) return "barcode";
  return "other";
}

/**
 * 判斷是哪一種通知：
 * - ReturnURL（付款結果）帶 PaymentDate
 * - PaymentInfoURL（取號結果）帶 ExpireDate、沒有 PaymentDate
 * - 定期定額（PeriodReturnURL）帶 TotalSuccessTimes 等欄位 → v0.1 不支援
 */
function sourceOf(p: Params): Source {
  if ("TotalSuccessTimes" in p || "PeriodType" in p) {
    throw new UnsupportedNotificationError("定期定額通知（PeriodReturnURL）目前還不支援");
  }
  if ("PaymentDate" in p) return "return";
  if ("ExpireDate" in p) return "payment-info";
  throw new UnsupportedNotificationError("無法辨識的通知：沒有 PaymentDate 也沒有 ExpireDate");
}

const CODE_ISSUED: Record<string, string> = { atm: "2", cvs: "10100073", barcode: "10100073" };

export function toEvent(p: Params, allowSimulated: boolean): GuardEvent {
  const source = sourceOf(p);
  const paymentType = p.PaymentType ?? "";
  const method = methodOf(paymentType);
  const rtnCode = p.RtnCode ?? "";
  const simulated = p.SimulatePaid === "1";

  let type: EventType;
  if (source === "return") {
    if (rtnCode !== "1") type = "payment.failed";
    else if (simulated && !allowSimulated) type = "payment.simulated";
    else type = "payment.succeeded";
  } else {
    type = CODE_ISSUED[method] === rtnCode ? "code.issued" : "code.failed";
  }

  const event: GuardEvent = {
    key: `${source}:${p.MerchantTradeNo ?? ""}:${p.TradeNo ?? ""}:${rtnCode}`,
    type,
    source,
    orderId: p.MerchantTradeNo ?? "",
    tradeNo: p.TradeNo ?? "",
    amount: Number(p.TradeAmt ?? 0),
    paymentType,
    method,
    simulated,
    rtnCode,
    rtnMsg: p.RtnMsg ?? "",
    customFields: [p.CustomField1 ?? "", p.CustomField2 ?? "", p.CustomField3 ?? "", p.CustomField4 ?? ""],
    raw: p,
  };
  if (source === "return" && p.PaymentDate) event.paidAt = p.PaymentDate;
  if (source === "payment-info") {
    event.code = { expireDate: p.ExpireDate ?? "" };
    if (p.BankCode) event.code.bankCode = p.BankCode;
    if (p.vAccount) event.code.vAccount = p.vAccount;
    if (p.PaymentNo) event.code.paymentNo = p.PaymentNo;
    if (p.Barcode1 || p.Barcode2 || p.Barcode3) {
      event.code.barcodes = [p.Barcode1 ?? "", p.Barcode2 ?? "", p.Barcode3 ?? ""];
    }
  }
  return event;
}
