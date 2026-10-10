import { describe, expect, it, vi } from "vitest";
import { createEcpayGuard, memoryStore, type GuardEvent, type GuardOptions } from "../src/index.js";
import { atmIssued, HASH_IV, HASH_KEY, MERCHANT_ID, paid, sign } from "./helpers.js";

function setup(over: Partial<GuardOptions> = {}) {
  const events: GuardEvent[] = [];
  const store = memoryStore();
  const guard = createEcpayGuard({
    merchantId: MERCHANT_ID,
    hashKey: HASH_KEY,
    hashIV: HASH_IV,
    store,
    log: () => {},
    onEvent: (e) => {
      events.push(e);
    },
    ...over,
  });
  return { guard, store, events };
}

describe("付款結果（ReturnURL）", () => {
  it("付款成功 → payment.succeeded，回 1|OK", async () => {
    const { guard, events } = setup();
    const r = await guard.handle(paid());
    expect(r).toMatchObject({ status: 200, body: "1|OK" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "payment.succeeded",
      orderId: "order001",
      tradeNo: "2310101234567890",
      amount: 990,
      method: "credit",
      simulated: false,
      paidAt: "2026/10/10 12:00:00",
    });
  });

  it("同一則通知送兩次 → 只處理一次，兩次都回 1|OK", async () => {
    const { guard, events } = setup();
    expect((await guard.handle(paid())).body).toBe("1|OK");
    expect((await guard.handle(paid())).body).toBe("1|OK");
    expect(events).toHaveLength(1);
  });

  it("同時送到兩次（處理中）→ 只處理一次，第二次回非 1|OK 讓綠界稍後重送", async () => {
    let finish!: () => void;
    const slow = new Promise<void>((r) => (finish = r));
    const onEvent = vi.fn(() => slow);
    const { guard } = setup({ onEvent });
    const first = guard.handle(paid());
    const second = await guard.handle(paid());
    expect(second).toMatchObject({ status: 409, body: "0|Processing" });
    finish();
    expect((await first).body).toBe("1|OK");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("付款失敗 → payment.failed", async () => {
    const { guard, events } = setup();
    await guard.handle(paid({ RtnCode: "10200095", RtnMsg: "交易失敗" }));
    expect(events[0]?.type).toBe("payment.failed");
  });

  it("檢查碼不對 → 400，不觸發事件", async () => {
    const { guard, events } = setup();
    const p = paid();
    const r = await guard.handle({ ...p, TradeAmt: "1" });
    expect(r).toMatchObject({ status: 400, body: "0|CheckMacValue Error" });
    expect(events).toHaveLength(0);
  });

  it("別家特店的通知 → 400", async () => {
    const { guard, events } = setup();
    const r = await guard.handle(paid({ MerchantID: "9999999" }));
    expect(r.status).toBe(400);
    expect(events).toHaveLength(0);
  });
});

describe("模擬付款（SimulatePaid=1）", () => {
  it("正式環境（預設）→ payment.simulated，不是付款成功", async () => {
    const { guard, events } = setup();
    await guard.handle(paid({ SimulatePaid: "1" }));
    expect(events[0]).toMatchObject({ type: "payment.simulated", simulated: true });
  });

  it("測試環境 → 視為付款成功，但仍標 simulated", async () => {
    const { guard, events } = setup({ env: "stage" });
    await guard.handle(paid({ SimulatePaid: "1" }));
    expect(events[0]).toMatchObject({ type: "payment.succeeded", simulated: true });
  });

  it("可以明確關掉：測試環境也不當真", async () => {
    const { guard, events } = setup({ env: "stage", allowSimulated: false });
    await guard.handle(paid({ SimulatePaid: "1" }));
    expect(events[0]?.type).toBe("payment.simulated");
  });
});

describe("ATM / 超商（PaymentInfoURL）", () => {
  it("ATM 先取號、三天後才付 → 先 code.issued，再 payment.succeeded，兩個都收到", async () => {
    const { guard, events } = setup();
    await guard.handle(atmIssued());
    await guard.handle(
      paid({ MerchantTradeNo: "order002", TradeNo: "2310101234567891", TradeAmt: "1490", PaymentType: "ATM_TAISHIN" }),
    );
    expect(events.map((e) => e.type)).toEqual(["code.issued", "payment.succeeded"]);
    expect(events[0]).toMatchObject({
      method: "atm",
      code: { bankCode: "812", vAccount: "9103522175887271", expireDate: "2026/10/13" },
    });
    expect(events[1]?.method).toBe("atm");
  });

  it("超商代碼取號成功是 10100073；條碼帶三段", async () => {
    const { guard, events } = setup();
    await guard.handle(
      atmIssued({ PaymentType: "CVS_CVS", RtnCode: "10100073", BankCode: "", vAccount: "", PaymentNo: "LLL22251222", ExpireDate: "2026/10/17 12:00:00" }),
    );
    await guard.handle(
      atmIssued({ MerchantTradeNo: "order003", TradeNo: "x3", PaymentType: "BARCODE_BARCODE", RtnCode: "10100073", BankCode: "", vAccount: "", Barcode1: "151017617", Barcode2: "1234567890123456", Barcode3: "101700000000990", ExpireDate: "2026/10/17 12:00:00" }),
    );
    expect(events[0]).toMatchObject({ type: "code.issued", method: "cvs", code: { paymentNo: "LLL22251222" } });
    expect(events[1]).toMatchObject({ type: "code.issued", method: "barcode" });
    expect(events[1]?.code?.barcodes).toEqual(["151017617", "1234567890123456", "101700000000990"]);
  });

  it("ATM 回 10100073 不算取號成功（每種方式的成功碼不同）", async () => {
    const { guard, events } = setup();
    await guard.handle(atmIssued({ RtnCode: "10100073" }));
    expect(events[0]?.type).toBe("code.failed");
  });
});

describe("處理失敗與重試", () => {
  it("onEvent 拋錯 → 回非 1|OK；綠界重送時再處理一次", async () => {
    let fail = true;
    const onEvent = vi.fn(() => {
      if (fail) throw new Error("db down");
    });
    const { guard } = setup({ onEvent });
    expect(await guard.handle(paid())).toMatchObject({ status: 500, body: "0|Handler Error" });
    fail = false;
    expect((await guard.handle(paid())).body).toBe("1|OK");
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("retryUnhandled 會重跑沒成功的事件，成功後不再重跑", async () => {
    let fail = true;
    const onEvent = vi.fn(() => {
      if (fail) throw new Error("db down");
    });
    const { guard } = setup({ onEvent });
    await guard.handle(paid());
    await guard.handle(atmIssued());
    expect(await guard.retryUnhandled()).toBe(0); // 仍失敗
    fail = false;
    expect(await guard.retryUnhandled()).toBe(2);
    expect(await guard.retryUnhandled()).toBe(0);
  });

  it("處理者當掉（租約過期）→ 別人可以接手", async () => {
    const { guard, store } = setup({ leaseMs: 1 });
    const e = (await guard.handle(paid())).event!;
    // 模擬：另一個處理者搶到後當掉，沒有 markHandled
    const s = memoryStore();
    await s.insert(e);
    expect(await s.claim(e.key, 1)).toBe(true);
    expect(await s.claim(e.key, 1)).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(await s.claim(e.key, 1)).toBe(true);
    expect(await store.isHandled(e.key)).toBe(true);
  });
});

describe("不支援的通知", () => {
  it("定期定額通知 → 400，並說明不支援", async () => {
    const { guard, events } = setup();
    const r = await guard.handle(paid({ PeriodType: "M", TotalSuccessTimes: "2" }));
    expect(r.status).toBe(400);
    expect(r.body).toContain("定期定額");
    expect(events).toHaveLength(0);
  });

  it("看不出是哪種通知 → 400", async () => {
    const { guard } = setup();
    const r = await guard.handle(sign({ MerchantID: MERCHANT_ID, MerchantTradeNo: "x", RtnCode: "1" }));
    expect(r.status).toBe(400);
  });
});
