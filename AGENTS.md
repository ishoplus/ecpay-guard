# 給 AI 的開發說明

這個套件只處理「綠界通知進來之後」。改程式前先讀這幾條，它們是這個套件存在的理由，不要為了讓測試過或讓程式變短而拿掉：

1. **開通只看伺服器通知**：不要加「從跳轉頁參數判斷付款成功」的功能。
2. **先驗簽再做任何事**：驗簽失敗不能觸發事件、不能寫入 store。
3. **去重靠 store 的原子操作**：`insert` 用唯一鍵、`claim` 用單一條件式 UPDATE。不要改成「先查再寫」兩步。
4. **只有處理成功才回 `1|OK`**：`onEvent` 失敗要回非 OK，讓綠界重送。
5. **模擬付款不能變成付款成功**（正式環境預設）。
6. **成功碼依付款方式不同**：ATM 取號是 `2`，超商 / 條碼是 `10100073`，付款成功是 `1`。

綠界規格來源：https://developers.ecpay.com.tw （檢查碼機制、付款結果通知、取號結果通知、URLEncode 轉換表）。規格有疑問時查文件，不要猜。

## 指令

```bash
npm test          # vitest，含 PGlite 跑真正的 Postgres SQL
npm run typecheck
npm run build     # tsup 出 ESM/CJS，tsc 出型別（tsup 內建 dts 和 TypeScript 7 不相容）
```

端到端（綠界測試環境）：`npm run build`，開一個公開隧道指到 127.0.0.1:17090，再跑 `node e2e/server.mjs <公開網址>`，用瀏覽器開首頁付款。
本機 cloudflared 臨時隧道要加 `--config <空檔>`，否則會被 ~/.cloudflared/config.yml 蓋掉。

改了行為就加測試；README 的「它幫你處理了什麼」表格要同步。
