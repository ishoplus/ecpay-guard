import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEcpayGuard, postgresStore } from "../src/index.js";
import { atmIssued, HASH_IV, HASH_KEY, MERCHANT_ID, paid } from "./helpers.js";

// 用 PGlite（WASM 版 Postgres）跑真正的 SQL，驗證 postgresStore 的語意
describe("postgresStore", () => {
  let store: ReturnType<typeof postgresStore>;
  beforeEach(async () => {
    store = postgresStore(new PGlite());
    await store.migrate();
  });

  function guard(onEvent: () => void | Promise<void>) {
    return createEcpayGuard({ merchantId: MERCHANT_ID, hashKey: HASH_KEY, hashIV: HASH_IV, store, log: () => {}, onEvent });
  }

  it("重複通知只處理一次", async () => {
    const onEvent = vi.fn();
    const g = guard(onEvent);
    expect((await g.handle(paid())).body).toBe("1|OK");
    expect((await g.handle(paid())).body).toBe("1|OK");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("失敗後 retryUnhandled 補跑；事件內容從 jsonb 完整還原", async () => {
    let fail = true;
    const g = guard(() => {
      if (fail) throw new Error("x");
    });
    await g.handle(atmIssued());
    const [e] = await store.listUnhandled();
    expect(e).toMatchObject({ type: "code.issued", code: { vAccount: "9103522175887271" } });
    fail = false;
    expect(await g.retryUnhandled()).toBe(1);
    expect(await store.listUnhandled()).toHaveLength(0);
  });

  it("claim：同時只有一個拿得到；租約過期後可接手；處理完就不能再拿", async () => {
    const g = guard(() => {});
    const e = (await g.handle(atmIssued())).event!;
    // 用另一筆未處理的事件測 claim
    const other = { ...e, key: "manual:1" };
    await store.insert(other);
    const results = await Promise.all([store.claim(other.key, 60_000), store.claim(other.key, 60_000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await store.release(other.key);
    expect(await store.claim(other.key, 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(await store.claim(other.key, 60_000)).toBe(true);
    await store.markHandled(other.key);
    expect(await store.claim(other.key, 60_000)).toBe(false);
    expect(await store.isHandled(other.key)).toBe(true);
  });

  it("不合法的資料表名稱直接拒絕", () => {
    expect(() => postgresStore(new PGlite(), { table: "x; drop table y" })).toThrow();
  });
});
