/**
 * Vercel Serverless Function — secure Gemini proxy.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/models";

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return send(res, 503, { error: "no key" });
  try {
    const upstream = await fetch(`${UPSTREAM}/gemini-flash-latest:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(text);
  } catch (err) {
    return send(res, 502, { error: "upstream error" });
  }
}
