import type { GuardEvent } from "./event.js";
import type { Store } from "./store.js";

/**
 * 只要有 query(sql, params) 就能用：node-postgres 的 Pool / Client、PGlite 都符合。
 * 不依賴任何資料庫套件。
 */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PostgresStoreOptions {
  /** 資料表名稱，預設 ecpay_events。只接受英數與底線。 */
  table?: string;
}

/** 建表 SQL。可以自己放進 migration，或呼叫 store.migrate()。 */
export function postgresSchema(table = "ecpay_events"): string {
  return `
create table if not exists ${table} (
  key          text primary key,
  event        jsonb not null,
  handled_at   timestamptz,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists ${table}_unhandled on ${table} (created_at) where handled_at is null;
`;
}

export function postgresStore(db: Queryable, opts: PostgresStoreOptions = {}): Store & { migrate(): Promise<void> } {
  const t = opts.table ?? "ecpay_events";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw new Error(`資料表名稱不合法：${t}`);
  return {
    async migrate() {
      for (const stmt of postgresSchema(t).split(";").map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
    },
    async insert(event: GuardEvent) {
      const r = await db.query(`insert into ${t} (key, event) values ($1, $2) on conflict (key) do nothing returning key`, [
        event.key,
        JSON.stringify(event),
      ]);
      return r.rows.length > 0;
    },
    async claim(key, leaseMs) {
      // 一條 UPDATE 完成「檢查 + 上鎖」，兩台機器同時搶也只有一台會拿到
      const r = await db.query(
        `update ${t} set locked_until = now() + make_interval(secs => $2::double precision / 1000)
         where key = $1 and handled_at is null and (locked_until is null or locked_until < now())
         returning key`,
        [key, leaseMs],
      );
      return r.rows.length > 0;
    },
    async isHandled(key) {
      const r = await db.query(`select handled_at is not null as handled from ${t} where key = $1`, [key]);
      return r.rows[0]?.handled === true;
    },
    async markHandled(key) {
      await db.query(`update ${t} set handled_at = now(), locked_until = null where key = $1`, [key]);
    },
    async release(key) {
      await db.query(`update ${t} set locked_until = null where key = $1 and handled_at is null`, [key]);
    },
    async listUnhandled() {
      const r = await db.query(`select event from ${t} where handled_at is null order by created_at limit 500`);
      return r.rows.map((row) => (typeof row.event === "string" ? JSON.parse(row.event) : row.event) as GuardEvent);
    },
  };
}
