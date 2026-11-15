/**
 * Vercel Serverless Function — health and diagnostics.
 *
 * GET /api/health
 *
 * Verifies the server-side Gemini configuration by calling Google's models.list
 * endpoint. Never exposes the API key. Distinguishes between:
 *   - not_configured   GEMINI_API_KEY is absent
 *   - invalid_key      key rejected by Google (401/403)
 *   - quota_exhausted  free tier quota used up (429)
 *   - model_unavailable configured GEMINI_MODEL not in account's model list
 *   - operational      key works and configured model is available
 *   - upstream_failure Google's API is unreachable or returned an error
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { send, fetchWithTimeout, type HealthStatus } from "./core";

const MODEL_LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-flash-latest";
const HEALTH_TIMEOUT_MS = 20_000;

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

  if (!key) {
    return send(res, 200, {
      ok: false,
      configured: false,
      model,
      status: "not_configured" as HealthStatus,
      message: "GEMINI_API_KEY is not set on the server.",
    });
  }

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(MODEL_LIST_URL, {
      headers: { "x-goog-api-key": key },
    }, HEALTH_TIMEOUT_MS);
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return send(res, 200, {
      ok: false,
      configured: true,
      model,
      status: "upstream_failure" as HealthStatus,
      message: timedOut
        ? "Google's AI API did not respond in time."
        : "Could not reach Google's AI API.",
    });
  }

  const raw = await upstream.text();

  if (upstream.status === 401 || upstream.status === 403) {
    return send(res, 200, {
      ok: false,
      configured: false,
      model,
      status: "invalid_key" as HealthStatus,
      message: "GEMINI_API_KEY is invalid or unauthorized.",
    });
  }

  if (upstream.status === 429) {
    return send(res, 200, {
      ok: false,
      configured: true,
      model,
      status: "quota_exhausted" as HealthStatus,
      message: "Gemini API quota has been exhausted.",
    });
  }

  if (!upstream.ok) {
    return send(res, 200, {
      ok: false,
      configured: true,
      model,
      status: "upstream_failure" as HealthStatus,
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
    status: (operational ? "operational" : "model_unavailable") as HealthStatus,
    message: operational
      ? "Gemini API is operational and the configured model is available."
      : `Configured model "${model}" is not available for this API key.`,
    availableModels: modelNames.length,
  });
}
