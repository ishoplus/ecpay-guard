// 綠界測試環境端到端：建立測試訂單 → 綠界頁面付款 → 通知經 ecpay-guard 處理
// 用法：node e2e/server.mjs <公開網址>      （先 npm run build）
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { computeCheckMacValue, createEcpayGuard, memoryStore } from "../dist/index.js";

const BASE = process.argv[2];
if (!BASE) throw new Error("要給公開網址，例如 https://xxx.trycloudflare.com");
const PORT = Number(process.env.PORT ?? 17090);
const LOG = new URL("./events.jsonl", import.meta.url);
// 綠界文件公開的測試特店
const MERCHANT_ID = "3002607", HASH_KEY = "pwFHCqoQZGmho4w6", HASH_IV = "EkRm7iFT261dpevs";

const events = [];
const guard = createEcpayGuard({
  merchantId: MERCHANT_ID, hashKey: HASH_KEY, hashIV: HASH_IV, env: "stage", store: memoryStore(),
  onEvent: (e) => {
    events.push(e);
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), kind: "event", type: e.type, orderId: e.orderId, method: e.method, amount: e.amount, simulated: e.simulated, code: e.code }) + "\n");
  },
});

function taipeiNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

function orderForm(choose) {
  const p = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: `eg${Date.now()}`.slice(0, 20),
    MerchantTradeDate: taipeiNow(),
    PaymentType: "aio",
    TotalAmount: "990",
    TradeDesc: "ecpay-guard 端到端測試",
    ItemName: "測試商品",
    ReturnURL: `${BASE}/notify`,
    PaymentInfoURL: `${BASE}/notify`,
    ClientBackURL: `${BASE}/`,
    ChoosePayment: choose,
    EncryptType: "1",
  };
  p.CheckMacValue = computeCheckMacValue(p, HASH_KEY, HASH_IV);
  const inputs = Object.entries(p).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}">`).join("");
  return `<form id="f" method="post" action="https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5">${inputs}</form><script>f.submit()</script>`;
}

const page = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<h2>ecpay-guard 端到端測試（綠界測試環境）</h2>
<p><a href="/pay?m=Credit">信用卡</a> ｜ <a href="/pay?m=ATM">ATM 取號</a> ｜ <a href="/pay?m=CVS">超商代碼</a></p>
<h3>收到的事件（${events.length}）</h3><pre>${events.map((e) => `${e.type}  ${e.orderId}  ${e.method}  NT$${e.amount}${e.simulated ? "  (simulated)" : ""}${e.code ? "  " + JSON.stringify(e.code) : ""}`).join("\n") || "（還沒有）"}</pre>`;

createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  if (req.method === "POST" && url.pathname === "/notify") {
    let body = "";
    for await (const c of req) body += c;
    const params = Object.fromEntries(new URLSearchParams(body));
    const r = await guard.handle(params);
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), kind: "notify", status: r.status, reply: r.body, params }) + "\n");
    res.writeHead(r.status, { "content-type": "text/plain" }).end(r.body);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(url.pathname === "/pay" ? orderForm(url.searchParams.get("m") ?? "Credit") : page());
}).listen(PORT, "127.0.0.1", () => console.log(`listening 127.0.0.1:${PORT} → ${BASE}`));
