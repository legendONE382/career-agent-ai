/**
 * Vercel Serverless Function — tells the front-end whether the server-side
 * Gemini key is configured AND actually works (never returns the key itself).
 *
 * Verifies against Google's models.list endpoint so the status distinguishes:
 *   - not_configured   GEMINI_API_KEY is absent
 *   - invalid_key      key rejected by Google (401/403)
 *   - quota_exhausted  free tier quota used up (429)
 *   - model_unavailable configured GEMINI_MODEL is not in the account's model list
 *   - operational      key works and the configured model is available
 *   - upstream_failure Google's API is unreachable or returned an error
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const MODEL_LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type HealthStatus =
  | "not_configured"
  | "invalid_key"
  | "quota_exhausted"
  | "model_unavailable"
  | "operational"
  | "upstream_failure";

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-flash-latest").trim();

  if (!key) {
    return send(res, 200, {
      ok: false,
      configured: false,
      model,
      status: "not_configured",
      message: "GEMINI_API_KEY is not set on the server.",
    });
  }

  let upstream: Response;
  try {
    const ctrl = new AbortController();
    upstream = await fetch(MODEL_LIST_URL, {
      signal: AbortSignal.timeout(20_000),
      headers: { "x-goog-api-key": key },
    });
    ctrl.abort(); // prevent the timer from keeping the process alive
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return send(res, 200, {
      ok: false,
      configured: true,
      model,
      status: "upstream_failure",
      message: timedOut ? "Google's AI API did not respond in time." : "Could not reach Google's AI API.",
    });
  }

  const raw = await upstream.text();

  if (upstream.status === 401 || upstream.status === 403) {
    return send(res, 200, {
      ok: false,
      configured: false,
      model,
      status: "invalid_key",
      message: "GEMINI_API_KEY is invalid or unauthorized.",
    });
  }

  if (upstream.status === 429) {
    return send(res, 200, {
      ok: false,
      configured: true,
      model,
      status: "quota_exhausted",
      message: "Gemini API quota has been exhausted.",
    });
  }

  if (!upstream.ok) {
    return send(res, 200, {
      ok: false,
      configured: true,
      model,
      status: "upstream_failure",
      message: `Google's AI API responded with an error (${upstream.status}).`,
    });
  }

  let data: { models?: { name?: string }[] } | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* ignore malformed */
  }

  const models = data && Array.isArray(data.models) ? data.models : [];
  const modelNames = models
    .map((m) => (m.name || "").replace(/^models\//, ""))
    .filter(Boolean);
  const available = modelNames.includes(model) || modelNames.some((n) => n.endsWith(`/${model}`) || n === model);

  const operational = available;
  return send(res, 200, {
    ok: operational,
    configured: true,
    model,
    status: operational ? "operational" : "model_unavailable",
    message: operational
      ? "Gemini API is operational and the configured model is available."
      : `Configured model "${model}" is not available for this API key.`,
    availableModels: modelNames.length,
  });
}
