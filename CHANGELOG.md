# 更新紀錄

## 0.1.0 — 2026-10-10
- 檢查碼計算與驗證（以綠界文件官方範例值測試）
- ReturnURL（付款結果）、PaymentInfoURL（ATM / 超商代碼 / 條碼取號）轉成統一事件
- 去重、處理權租約、失敗重試（`retryUnhandled`）
- 模擬付款（SimulatePaid）在正式環境變成 `payment.simulated`
- Next.js、Express handler
- `memoryStore`、`postgresStore`（不依賴資料庫套件）
- 綠界測試環境端到端驗證：信用卡、ATM、超商代碼；三則真實通知收錄為回歸測試（`test/fixtures-stage.json`）
- `e2e/server.mjs`：自己在測試環境建單、收通知的小伺服器
