/**
 * Vercel Serverless Function — secure Gemini proxy.
 *
 * The browser POSTs a Gemini `generateContent` payload here; the function adds the
 * secret GEMINI_API_KEY (never shipped to the client) and forwards it to Google.
 * Hardened with: same-origin check, per-IP rate limiting, strict payload validation
 * (allow-listed media types, size caps) and user-safe error messages.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_MODEL = "gemini-flash-latest";
const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BODY_BYTES = 4_400_000; // Vercel's request body limit is 4.5 MB

const ALLOWED_MIME =
  /^(video\/(webm|mp4)|image\/(png|jpeg|webp)|audio\/(webm|mp4|mpeg|wav|x-wav|ogg)|application\/pdf)$/;

export type Req = IncomingMessage & { body?: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Browsers calling from another site are rejected (basic CSRF / hot-link guard). */
function originAllowed(req: Req): boolean {
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
  if (first) return first.trim();
  try {
    return (req.socket.remoteAddress || "unknown").trim();
  } catch {
    return "unknown";
  }
}

/* Best-effort per-instance rate limit (serverless instances are ephemeral, but this
   stops bursts from a single visitor hammering the free Gemini quota). */
const buckets = new Map<string, { start: number; count: number }>();

function rateLimit(req: Req, res: ServerResponse, max = 40, windowMs = 10 * 60_000): boolean {
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
async function readJsonBody(req: Req, maxBytes: number): Promise<unknown> {
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

/** Returns an error string, or null when the payload is acceptable. */
function validatePayload(body: Record<string, unknown>): string | null {
  const { contents, systemInstruction, generationConfig } = body;
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > 4) return "Invalid request.";
  for (const item of contents) {
    if (!isObj(item) || !Array.isArray(item.parts) || item.parts.length === 0 || item.parts.length > 8) return "Invalid request.";
    for (const part of item.parts) {
      if (!isObj(part)) return "Invalid request.";
      if (typeof part.text === "string") {
        if (part.text.length > 80_000) return "Request text is too long.";
      } else if (isObj(part.inlineData)) {
        const mime = String(part.inlineData.mimeType || "").split(";")[0].trim();
        const data = part.inlineData.data;
        if (!ALLOWED_MIME.test(mime)) return "Unsupported media type.";
        if (typeof data !== "string" || data.length === 0 || data.length > 4_200_000) return "Media payload is too large.";
      } else {
        return "Invalid request.";
      }
    }
  }
  if (systemInstruction !== undefined && JSON.stringify(systemInstruction).length > 25_000) return "Invalid request.";
  if (generationConfig !== undefined && (!isObj(generationConfig) || JSON.stringify(generationConfig).length > 30_000)) {
    return "Invalid request.";
  }
  return null;
}

export default async function handler(req: Req, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed." });
    }
    if (!originAllowed(req)) return send(res, 403, { error: "Request not allowed." });
    if (!rateLimit(req, res, 40)) return;

    const key = (process.env.GEMINI_API_KEY || "").trim();
    if (!key) {
      console.error("[careeragent] GEMINI_API_KEY is not configured on the server.");
      return send(res, 503, { code: "not_configured", error: "Our AI coach is briefly unavailable. Please try again in a moment." });
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES);
    } catch {
      return send(res, 413, { error: "That recording is a bit too large. Keep answers under 90 seconds and try again." });
    }
    if (!isObj(body)) return send(res, 400, { error: "Invalid request." });

    const invalid = validatePayload(body);
    if (invalid) return send(res, 400, { error: invalid });

    const payload: Record<string, unknown> = { contents: body.contents };
    if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
    if (isObj(body.generationConfig)) {
      const gc = { ...body.generationConfig };
      if (typeof gc.maxOutputTokens === "number") gc.maxOutputTokens = Math.min(gc.maxOutputTokens, 32768);
      payload.generationConfig = gc;
    }

    const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
    const url = `${UPSTREAM}/${encodeURIComponent(model)}:generateContent`;

    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(55_000),
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(text);
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      console.error("[careeragent] upstream error:", err);
      return send(res, timedOut ? 504 : 502, {
        error: timedOut
          ? "That took longer than expected. Please try again."
          : "We couldn't reach our AI service. Please try again in a moment.",
      });
    }
  } catch (err) {
    console.error("[careeragent] unexpected error:", err);
    return send(res, 500, { error: "Unexpected server error. Please try again." });
  }
}
