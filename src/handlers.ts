import type { Params } from "./checkmac.js";
import type { Guard } from "./guard.js";

function fromForm(text: string): Params {
  return Object.fromEntries(new URLSearchParams(text));
}

/**
 * Next.js App Router（或任何 Web 標準 Request / Response 的環境）。
 *
 *   // app/api/ecpay/notify/route.ts
 *   export const POST = nextHandler(guard);
 */
export function nextHandler(guard: Guard): (req: Request) => Promise<Response> {
  return async (req) => {
    const result = await guard.handle(fromForm(await req.text()));
    return new Response(result.body, { status: result.status, headers: { "content-type": "text/plain" } });
  };
}

/** 只用到 Express 的這幾個成員，不需要安裝 express 的型別。 */
interface ExpressLikeRequest extends AsyncIterable<Buffer | string> {
  body?: unknown;
}
interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  type(t: string): ExpressLikeResponse;
  send(body: string): unknown;
}

/**
 * Express。有沒有先掛 express.urlencoded() 都可以：
 * 已解析好就用 req.body，沒有就自己讀原始內容。
 */
export function expressHandler(guard: Guard): (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void> {
  return async (req, res) => {
    let params: Params;
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      params = Object.fromEntries(Object.entries(req.body as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    } else {
      let text = "";
      for await (const chunk of req) text += chunk.toString();
      params = fromForm(text);
    }
    const result = await guard.handle(params);
    res.status(result.status).type("text/plain").send(result.body);
  };
}
