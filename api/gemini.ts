/**
 * Vercel Serverless Function — secure Gemini proxy.
 *
 * The browser POSTs a Gemini `generateContent` payload here; the function adds the
 * secret GEMINI_API_KEY (never shipped to the client) and forwards it to Google.
 *
 * Hardened with:
 *   - Same-origin check
 *   - Per-IP rate limiting
 *   - Strict payload validation (allow-listed media types, size caps)
 *   - Bounded retries with exponential backoff
 *   - Explicit request timeouts
 *   - Consistent JSON error responses (never exposes the API key)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  send,
  readRequestBody,
  isObj,
  HttpError,
  rateLimit,
  originAllowed,
  fetchWithTimeout,
  mapGeminiHttpError,
  makeGeminiError,
  type GeminiError,
  type GeminiErrorCode,
} from "./core";

const DEFAULT_MODEL = "gemini-flash-latest";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BODY_BYTES = 4_400_000; // Vercel's request body limit is 4.5 MB
const UPSTREAM_TIMEOUT_MS = 55_000;
const MAX_RETRIES = 2;

const ALLOWED_MIME =
  /^(video\/(webm|mp4)|image\/(png|jpeg|webp)|audio\/(webm|mp4|mpeg|wav|x-wav|ogg)|application\/pdf)$/;

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GenRequestBody {
  contents?: unknown;
  systemInstruction?: unknown;
  generationConfig?: unknown;
}

interface GeminiCandidate {
  finishReason?: string;
  content?: { parts?: { text?: string; thought?: boolean }[] };
}

interface GeminiResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: GeminiCandidate[];
}

const isGeminiError = (e: unknown): e is GeminiError => e instanceof Error && (e as GeminiError).code !== undefined;

/** Validate the incoming generateContent payload shape. */
function validatePayload(body: GenRequestBody): string | null {
  const { contents } = body;
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > 4) return "Invalid request.";
  for (const item of contents) {
    if (!isObj(item) || !Array.isArray(item.parts) || item.parts.length === 0 || item.parts.length > 8) {
      return "Invalid request.";
    }
    for (const part of item.parts) {
      if (!isObj(part)) return "Invalid request.";
      if (typeof part.text === "string") {
        if (part.text.length > 80_000) return "Request text is too long.";
      } else if (isObj(part.inlineData)) {
        const mime = String(part.inlineData.mimeType || "").split(";")[0].trim();
        const data = part.inlineData.data;
        if (!ALLOWED_MIME.test(mime)) return "Unsupported media type.";
        if (typeof data !== "string" || data.length === 0 || data.length > 4_200_000) {
          return "Media payload is too large.";
        }
      } else {
        return "Invalid request.";
      }
    }
  }
  if (body.systemInstruction !== undefined && JSON.stringify(body.systemInstruction).length > 25_000) {
    return "Invalid request.";
  }
  if (body.generationConfig !== undefined && (!isObj(body.generationConfig) || JSON.stringify(body.generationConfig).length > 30_000)) {
    return "Invalid request.";
  }
  return null;
}

function buildPayload(body: GenRequestBody): Record<string, unknown> {
  const payload: Record<string, unknown> = { contents: body.contents };
  if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
  if (isObj(body.generationConfig)) {
    const gc = { ...body.generationConfig };
    if (typeof gc.maxOutputTokens === "number") gc.maxOutputTokens = Math.min(gc.maxOutputTokens, 32768);
    payload.generationConfig = gc;
  }
  return payload;
}

function extractText(data: unknown): string {
  const d = data as GeminiResponse;
  if (d.promptFeedback?.blockReason) {
    throw makeGeminiError("blocked", "Gemini's safety filter blocked this request. Try rephrasing.");
  }
  const cand = d.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("");
  if (!text.trim()) {
    const reason = cand?.finishReason;
    if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
      throw makeGeminiError("blocked", "Gemini couldn't produce a response for this content. Please try again.");
    }
    throw makeGeminiError("bad_response", "The AI returned an empty response. Please try again.");
  }
  return text;
}

function parseJsonText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    /* try to salvage */
  }
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {
      /* fall through */
    }
  }
  throw makeGeminiError("bad_response", "The AI returned malformed data. Please try again.");
}

export default async function handler(req: Req, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed.", code: "method_not_allowed" });
    }
    if (!originAllowed(req)) return send(res, 403, { error: "Request not allowed.", code: "forbidden" });
    if (!rateLimit(req, res, 40)) return;

    const key = (process.env.GEMINI_API_KEY || "").trim();
    if (!key) {
      return send(res, 503, {
        error: "Our AI coach is briefly unavailable. Please try again in a moment.",
        code: "not_configured",
      });
    }

    let body: unknown;
    try {
      body = await readRequestBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      return send(res, 400, { error: "Invalid request body.", code: "bad_request" });
    }
    if (!isObj(body)) return send(res, 400, { error: "Invalid request.", code: "bad_request" });

    const invalid = validatePayload(body as GenRequestBody);
    if (invalid) return send(res, 400, { error: invalid, code: "bad_request" });

    const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
    const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
    const payload = buildPayload(body as GenRequestBody);

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const upstream = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(payload),
        }, UPSTREAM_TIMEOUT_MS);

        const raw = await upstream.text();
        if (!upstream.ok) {
          const mapped = mapGeminiHttpError(upstream.status, null, raw);
          if (mapped.code === "quota_exhausted" || mapped.code === "upstream_failure") {
            if (attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
              continue;
            }
          }
          return send(res, upstream.status, { error: mapped.message, code: mapped.code });
        }

        let data: unknown = null;
        try {
          data = JSON.parse(raw);
        } catch {
          throw makeGeminiError("bad_response", "The AI returned an unreadable response. Please try again.", 502);
        }
        if (!data) throw makeGeminiError("bad_response", "The AI returned an empty response. Please try again.", 502);

        const text = extractText(data);
        return send(res, 200, { text });
      } catch (err) {
        if (isGeminiError(err)) {
          lastError = err;
          if ((err.code === "quota_exhausted" || err.code === "upstream_failure" || err.code === "timeout") && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
            continue;
          }
          const status = err.status ?? 500;
          return send(res, status, { error: err.message, code: err.code });
        }
        // Non-GeminiError (e.g. network failure from fetch) → map to upstream_failure
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          continue;
        }
        return send(res, 502, { error: "We couldn't reach our AI service. Please try again in a moment.", code: "upstream_failure" });
      }
    }

    return send(res, 500, { error: "Unexpected server error. Please try again.", code: "internal_error" });
  } catch (err) {
    return send(res, 500, { error: "Unexpected server error. Please try again.", code: "internal_error" });
  }
}
