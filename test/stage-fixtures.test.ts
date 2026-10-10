import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEcpayGuard, memoryStore, verifyCheckMacValue, type GuardEvent } from "../src/index.js";
import { HASH_IV, HASH_KEY, MERCHANT_ID } from "./helpers.js";

// 2026-10-10 綠界測試環境實際送來的通知（e2e/server.mjs 收到的原文，含綠界算的檢查碼）
const real: Record<"credit" | "atm" | "cvs", Record<string, string>> = JSON.parse(
  readFileSync(new URL("./fixtures-stage.json", import.meta.url), "utf8"),
);

describe("綠界測試環境的真實通知", () => {
  it("三則的檢查碼都驗得過（含小寫開頭的 vAccount，證明排序不分大小寫）", () => {
    for (const p of Object.values(real)) expect(verifyCheckMacValue(p, HASH_KEY, HASH_IV)).toBe(true);
  });

  it("轉成正確的事件", async () => {
    const events: GuardEvent[] = [];
    const guard = createEcpayGuard({
      merchantId: MERCHANT_ID, hashKey: HASH_KEY, hashIV: HASH_IV, store: memoryStore(), log: () => {},
      onEvent: (e) => {
        events.push(e);
      },
    });
    for (const p of [real.credit, real.atm, real.cvs]) expect((await guard.handle(p)).body).toBe("1|OK");
    expect(events.map((e) => [e.type, e.method])).toEqual([
      ["payment.succeeded", "credit"],
      ["code.issued", "atm"],
      ["code.issued", "cvs"],
    ]);
    expect(events[1]?.code).toMatchObject({ bankCode: "822", vAccount: "9251262860542137" });
    expect(events[2]?.code?.paymentNo).toBe("LLL26283055430");
  });
});
