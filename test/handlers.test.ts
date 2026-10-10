import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createEcpayGuard, expressHandler, memoryStore, nextHandler, type GuardEvent } from "../src/index.js";
import { HASH_IV, HASH_KEY, MERCHANT_ID, paid } from "./helpers.js";

function setup() {
  const events: GuardEvent[] = [];
  const guard = createEcpayGuard({
    merchantId: MERCHANT_ID,
    hashKey: HASH_KEY,
    hashIV: HASH_IV,
    store: memoryStore(),
    log: () => {},
    onEvent: (e) => {
      events.push(e);
    },
  });
  return { guard, events };
}

const form = (p: Record<string, string>) => new URLSearchParams(p).toString();

function fakeRes() {
  const out = { status: 0, type: "", body: "" };
  const res = {
    status(c: number) {
      out.status = c;
      return res;
    },
    type(t: string) {
      out.type = t;
      return res;
    },
    send(b: string) {
      out.body = b;
    },
  };
  return { res, out };
}

describe("nextHandler", () => {
  it("讀表單內容（含中文、空白）並回純文字 1|OK", async () => {
    const { guard, events } = setup();
    const req = new Request("https://example.com/api/ecpay", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form(paid({ RtnMsg: "交易 成功", CustomField1: "方案 A" })),
    });
    const res = await nextHandler(guard)(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1|OK");
    expect(events[0]?.customFields[0]).toBe("方案 A");
  });
});

describe("expressHandler", () => {
  it("已掛 express.urlencoded()：用 req.body", async () => {
    const { guard, events } = setup();
    const req = Object.assign(Readable.from([]), { body: paid() });
    const { res, out } = fakeRes();
    await expressHandler(guard)(req, res);
    expect(out).toEqual({ status: 200, type: "text/plain", body: "1|OK" });
    expect(events).toHaveLength(1);
  });

  it("沒掛 body parser：自己讀原始內容", async () => {
    const { guard, events } = setup();
    const req = Readable.from([Buffer.from(form(paid()))]);
    const { res, out } = fakeRes();
    await expressHandler(guard)(req, res);
    expect(out.body).toBe("1|OK");
    expect(events).toHaveLength(1);
  });
});
