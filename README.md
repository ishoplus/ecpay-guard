# ecpay-guard

把綠界送來的付款通知，變成**可靠、不重複、不遺漏**的付款事件。

接綠界最難的不是付款按鈕，是付款之後：

- 買家付完跳回的頁面被關掉了，訂單卻沒開通
- 同一則通知送來兩次，權限開了兩次、信寄了兩封
- ATM、超商是「先取號、三天後才付」，程式只會處理信用卡
- 後台按了「模擬付款」，系統當成真的出貨
- 處理到一半資料庫掛了，這筆就再也沒人管

ecpay-guard 不是 SDK（建立訂單請用[綠界官方 SDK](https://github.com/ECPay) 或其他套件），它只負責**收到通知之後**這一段。

- 零執行期依賴，Node 18+，ESM / CommonJS 都可以
- 檢查碼演算法以綠界文件的官方範例值測試

> 狀態：v0.1。已在**綠界測試環境**端到端驗證（2026-10-10）：信用卡付款、ATM 取號、超商代碼取號三種通知都正確驗簽、轉成事件並回 `1|OK`，原始通知收錄為回歸測試。尚未在正式環境收過真錢。

## 安裝

```bash
npm install ecpay-guard
```

## 用法（Next.js）

```ts
// lib/ecpay.ts
import { createEcpayGuard, postgresStore } from "ecpay-guard";
import { Pool } from "pg";

export const guard = createEcpayGuard({
  merchantId: process.env.ECPAY_MERCHANT_ID!,
  hashKey: process.env.ECPAY_HASH_KEY!,
  hashIV: process.env.ECPAY_HASH_IV!,
  env: "prod", // 測試環境填 "stage"
  store: postgresStore(new Pool()),
  onEvent: async (e) => {
    switch (e.type) {
      case "payment.succeeded":
        await grantAccess(e.orderId); // 請寫成重複執行也沒關係（例如 upsert）
        break;
      case "code.issued":
        await emailPaymentCode(e.orderId, e.code!); // ATM 帳號 / 超商代碼 + 繳費期限
        break;
      case "payment.simulated":
        // 後台模擬付款：買家沒付錢，不要出貨
        break;
    }
  },
});
```

```ts
// app/api/ecpay/notify/route.ts —— ReturnURL 和 PaymentInfoURL 都填這個網址
import { nextHandler } from "ecpay-guard";
import { guard } from "@/lib/ecpay";

export const POST = nextHandler(guard);
```

**Express**：

```ts
import { expressHandler } from "ecpay-guard";
app.post("/ecpay/notify", expressHandler(guard)); // 有沒有掛 express.urlencoded() 都可以
```

## 事件

| type | 什麼時候 | 你該做什麼 |
|---|---|---|
| `payment.succeeded` | 付款成功 | 開通、出貨 |
| `payment.failed` | 付款失敗 | 通知買家重試 |
| `payment.simulated` | 正式環境收到後台「模擬付款」 | **不要出貨**（綠界不會撥款） |
| `code.issued` | ATM / 超商代碼 / 條碼取號成功 | 把繳費資訊寄給買家；**還沒付錢** |
| `code.failed` | 取號失敗 | 請買家換付款方式 |

每個事件都有：`orderId`（你的 MerchantTradeNo）、`tradeNo`（綠界交易編號）、`amount`、`method`（`credit` / `atm` / `webatm` / `cvs` / `barcode` / `other`）、`simulated`、`customFields`、`raw`（原始參數）。

## 它幫你處理了什麼

| 狀況 | 處理方式 |
|---|---|
| 檢查碼不對 | 丟棄，回 `0|CheckMacValue Error`，記錄 |
| 別家特店的通知 | 丟棄 |
| 同一則通知送兩次 | 第二次直接回 `1|OK`，不會再呼叫 `onEvent` |
| 兩台機器同時收到同一則 | 用資料庫原子操作搶處理權，只有一台會處理 |
| `onEvent` 拋錯 | 回非 `1|OK`，綠界會在 5–15 分鐘後重送（一天最多四次）；也可以自己排程 `guard.retryUnhandled()` |
| 處理到一半機器當掉 | 租約（預設 60 秒）過期後，重送或 `retryUnhandled()` 會接手 |
| 後台模擬付款 | 正式環境變成 `payment.simulated`；測試環境（`env: "stage"`）照常當付款成功，但 `simulated: true` |
| 定期定額通知 | v0.1 還不支援，回 400 並記錄（不會默默吞掉） |

**為什麼不能只看跳轉頁**：綠界文件明確要求以伺服器通知為準。把付款結果頁（OrderResultURL / ClientBackURL）只當成「顯示用」，開通一律交給 `onEvent`。

## 資料庫

`postgresStore` 接受任何有 `query(sql, params)` 的物件（node-postgres 的 `Pool`、PGlite 都可以），不需要額外安裝。

```ts
const store = postgresStore(pool);
await store.migrate(); // 或把 postgresSchema() 的 SQL 放進你的 migration
```

用別的資料庫：實作 `Store` 介面（`src/store.ts`，六個方法）。`insert` 與 `claim` 必須是原子操作。
`memoryStore()` 只適合測試：重啟就忘、多台機器不共享。

## 排程（建議）

```ts
// 每 10 分鐘：重跑沒處理成功的事件
await guard.retryUnhandled();
```

## 其他工具

```ts
import { computeCheckMacValue, verifyCheckMacValue } from "ecpay-guard";
```

## 路線

- v0.2：主動查詢補漏（QueryTradeInfo），處理「通知根本沒送到」；內建限速，避開綠界的 403 / 30 分鐘封鎖
- v0.3：定期定額（PeriodReturnURL、扣款失敗）
- 之後：電子發票

## 授權

MIT
