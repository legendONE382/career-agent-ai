/**
 * Vercel Serverless Function — secure Gemini proxy.
 *
 * The browser POSTs a Gemini `generateContent` payload here; the function adds the
 * secret GEMINI_API_KEY (never shipped to the client) and forwards it to Google.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_MODEL = "gemini-flash-latest";
const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BODY_BYTES = 4_400_000;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  if (_req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) {
    return send(res, 503, { code: "not_configured", error: "AI unavailable." });
  }

  let body: unknown;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of _req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      if (size > MAX_BODY_BYTES) throw new Error("too_large");
      chunks.push(buf);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return send(res, 413, { error: "Payload too large or invalid JSON." });
  }

  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const url = `${UPSTREAM}/${encodeURIComponent(model)}:generateContent`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return send(res, timedOut ? 504 : 502, {
      error: timedOut ? "Request timed out." : "Upstream error.",
    });
  }
}
