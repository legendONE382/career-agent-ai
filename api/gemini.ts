/**
 * Vercel Serverless Function — secure Gemini proxy.
 *
 * The browser POSTs a Gemini `generateContent` payload here; the function adds the
 * secret GEMINI_API_KEY (never shipped to the client) and forwards it to Google.
 * Hardened with: same-origin check, per-IP rate limiting, strict payload validation
 * (allow-listed media types, size caps) and user-safe error messages.
 */
import type { ServerResponse } from "node:http";
import { originAllowed, rateLimit, readJsonBody, send, type Req } from "./_lib.ts";

const DEFAULT_MODEL = "gemini-flash-latest";
const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BODY_BYTES = 4_400_000; // Vercel's request body limit is 4.5 MB

const ALLOWED_MIME =
  /^(video\/(webm|mp4)|image\/(png|jpeg|webp)|audio\/(webm|mp4|mpeg|wav|x-wav|ogg)|application\/pdf)$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

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
    return await handleRequest(req, res);
  } catch (err) {
    console.error("[careeragent] unexpected error:", err);
    return send(res, 500, { error: "Unexpected server error. Please try again." });
  }
}

async function handleRequest(req: Req, res: ServerResponse) {
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
}
