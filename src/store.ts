import type { GuardEvent } from "./event.js";

/**
 * 存放通知的地方。正式環境請接自己的資料庫（docs/postgres.md 有範例），
 * insert 與 claim 必須是原子操作 —— 兩台機器同時收到同一則通知時，靠它們保證只處理一次。
 */
export interface Store {
  /** 存下事件。已經存在（同一個 key）就回 false。 */
  insert(event: GuardEvent): Promise<boolean>;
  /**
   * 搶處理權：事件還沒處理完、而且沒有別人正在處理（或對方的租約已過期）時，
   * 把租約設為 now + leaseMs 並回 true；否則回 false。
   */
  claim(key: string, leaseMs: number): Promise<boolean>;
  /** 這個事件是否已經處理成功。 */
  isHandled(key: string): Promise<boolean>;
  /** 處理成功。 */
  markHandled(key: string): Promise<void>;
  /** 處理失敗：放掉租約，讓下一次重送或 retryUnhandled 可以再處理。 */
  release(key: string): Promise<void>;
  /** 還沒處理成功的事件（給 retryUnhandled 用）。 */
  listUnhandled(): Promise<GuardEvent[]>;
}

interface Row {
  event: GuardEvent;
  handled: boolean;
  lockedUntil: number;
}

/** 記憶體版本。只適合測試與本機開發：重啟就忘、多台機器之間不共享。 */
export function memoryStore(): Store {
  const rows = new Map<string, Row>();
  return {
    async insert(event) {
      if (rows.has(event.key)) return false;
      rows.set(event.key, { event, handled: false, lockedUntil: 0 });
      return true;
    },
    async claim(key, leaseMs) {
      const r = rows.get(key);
      const now = Date.now();
      if (!r || r.handled || r.lockedUntil > now) return false;
      r.lockedUntil = now + leaseMs;
      return true;
    },
    async isHandled(key) {
      return rows.get(key)?.handled ?? false;
    },
    async markHandled(key) {
      const r = rows.get(key);
      if (r) r.handled = true;
    },
    async release(key) {
      const r = rows.get(key);
      if (r) r.lockedUntil = 0;
    },
    async listUnhandled() {
      return [...rows.values()].filter((r) => !r.handled).map((r) => r.event);
    },
  };
}
