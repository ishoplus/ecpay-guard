import { verifyCheckMacValue, type Params } from "./checkmac.js";
import { toEvent, UnsupportedNotificationError, type GuardEvent } from "./event.js";
import type { Store } from "./store.js";

export interface GuardOptions {
  merchantId: string;
  hashKey: string;
  hashIV: string;
  /** "stage" 是綠界測試環境。預設 "prod"。 */
  env?: "stage" | "prod";
  store: Store;
  /**
   * 處理事件。拋出錯誤代表沒處理好：會回應綠界非 1|OK，綠界 5–15 分鐘後重送（一天最多四次），
   * 也可以用 retryUnhandled() 自己重跑。
   * 機器在處理到一半時當掉，同一事件可能再跑一次 —— 開通權限請寫成「重複執行也沒關係」（例如 upsert）。
   */
  onEvent: (event: GuardEvent) => Promise<void> | void;
  /**
   * 是否把後台的「模擬付款」當成付款成功。預設：測試環境 true、正式環境 false。
   * 為 false 時，模擬付款會變成 payment.simulated 事件，不會是 payment.succeeded。
   */
  allowSimulated?: boolean;
  /** 處理一則事件的租約時間，超過就視為處理者當掉、別人可以接手。預設 60 秒。 */
  leaseMs?: number;
  /** 記錄異常（驗簽失敗、處理失敗等）。預設 console.warn。 */
  log?: (message: string, detail?: unknown) => void;
}

export interface GuardResult {
  status: number;
  /** 回給綠界的內容。只有 "1|OK" 代表收到並處理完成。 */
  body: string;
  event?: GuardEvent;
}

export interface Guard {
  /** 處理一則已解析的通知參數。框架 handler 都是包這個。 */
  handle(params: Params): Promise<GuardResult>;
  /** 重跑所有還沒處理成功的事件，回傳成功處理的筆數。適合放在排程裡。 */
  retryUnhandled(): Promise<number>;
}

const OK = "1|OK";

export function createEcpayGuard(opts: GuardOptions): Guard {
  const allowSimulated = opts.allowSimulated ?? opts.env === "stage";
  const leaseMs = opts.leaseMs ?? 60_000;
  const log = opts.log ?? ((m: string, d?: unknown) => console.warn(`[ecpay-guard] ${m}`, d ?? ""));

  async function process(event: GuardEvent): Promise<boolean> {
    if (!(await opts.store.claim(event.key, leaseMs))) return false;
    try {
      await opts.onEvent(event);
    } catch (err) {
      await opts.store.release(event.key);
      log(`處理事件失敗 ${event.key}`, err);
      throw err;
    }
    await opts.store.markHandled(event.key);
    return true;
  }

  return {
    async handle(params) {
      if (!verifyCheckMacValue(params, opts.hashKey, opts.hashIV)) {
        log("CheckMacValue 驗證失敗，忽略這則通知", { MerchantTradeNo: params.MerchantTradeNo });
        return { status: 400, body: "0|CheckMacValue Error" };
      }
      if (params.MerchantID !== opts.merchantId) {
        log("MerchantID 不符，忽略這則通知", { MerchantID: params.MerchantID });
        return { status: 400, body: "0|MerchantID Error" };
      }

      let event: GuardEvent;
      try {
        event = toEvent(params, allowSimulated);
      } catch (err) {
        if (err instanceof UnsupportedNotificationError) {
          log(err.message, { MerchantTradeNo: params.MerchantTradeNo });
          return { status: 400, body: `0|${err.message}` };
        }
        throw err;
      }

      // 已存在的事件不再插入，但如果上次沒處理成功，這次重送就再處理一次
      await opts.store.insert(event);
      try {
        await process(event);
      } catch {
        return { status: 500, body: "0|Handler Error", event };
      }
      // 沒搶到處理權：可能已經處理完（重複通知），也可能別人正在處理
      return (await opts.store.isHandled(event.key))
        ? { status: 200, body: OK, event }
        : { status: 409, body: "0|Processing", event };
    },

    async retryUnhandled() {
      let done = 0;
      for (const event of await opts.store.listUnhandled()) {
        try {
          if (await process(event)) done++;
        } catch {
          // 已記錄，留給下一輪
        }
      }
      return done;
    },
  };
}
