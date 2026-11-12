/**
 * Shared helpers for the serverless API (files prefixed with "_" are not routes).
 * Keeps user-facing errors friendly — operational detail goes to server logs only.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type Req = IncomingMessage & { body?: unknown };

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Browsers calling from another site are rejected (basic CSRF / hot-link guard). */
export function originAllowed(req: Req): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients / same-origin GETs
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clientIp(req: Req): string {
  const xf = req.headers["x-forwarded-for"];
  const first = Array.isArray(xf) ? xf[0] : xf?.split(",")[0];
  return (first || req.socket.remoteAddress || "unknown").trim();
}

/* Best-effort per-instance rate limit (serverless instances are ephemeral, but this
   stops bursts from a single visitor hammering the free Gemini quota). */
const buckets = new Map<string, { start: number; count: number }>();

export function rateLimit(req: Req, res: ServerResponse, max = 40, windowMs = 10 * 60_000): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(ip, b);
  }
  b.count++;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
  }
  if (b.count > max) {
    res.setHeader("Retry-After", "60");
    send(res, 429, { error: "You're going a little fast — please wait a minute and try again." });
    return false;
  }
  return true;
}

/** Reads a JSON body (Vercel may pre-parse it) with a hard size cap. */
export async function readJsonBody(req: Req, maxBytes: number): Promise<unknown> {
  const existing = req.body;
  if (existing !== undefined && existing !== null) {
    if (typeof existing === "string") {
      if (existing.length > maxBytes) throw new Error("too_large");
      try {
        return JSON.parse(existing);
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(existing)) {
      if (existing.length > maxBytes) throw new Error("too_large");
      try {
        return JSON.parse(existing.toString("utf8"));
      } catch {
        return null;
      }
    }
    return existing;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > maxBytes) throw new Error("too_large");
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
