/**
 * Gemini client.
 *
 * Backend resolution (automatic):
 *   1. /api/gemini  → Vercel serverless proxy that holds the secret GEMINI_API_KEY (recommended)
 *   2. VITE_GEMINI_API_KEY → direct browser call (local dev / static hosting only; key is public!)
 *   3. none → UI offers Demo Mode (simulated AI) so the app is never a dead end.
 */
import type { AnswerAnalysis, Question, SessionSummary, TailorResult } from "../types";
import {
  ANALYZE_SCHEMA,
  ANALYZE_SYSTEM,
  PDF_EXTRACT_PROMPT,
  QUESTIONS_SCHEMA,
  QUESTIONS_SYSTEM,
  SUMMARY_SCHEMA,
  SUMMARY_SYSTEM,
  TAILOR_SCHEMA,
  TAILOR_SYSTEM,
  analyzePrompt,
  questionsPrompt,
  summaryPrompt,
  tailorPrompt,
} from "./prompts";
import { normalizeAnalysis, normalizeQuestions, normalizeSummary, normalizeTailor } from "./normalize";
import { buildLocalSummary } from "./scoring";
import { demoAnalysis, demoQuestions, demoTailor } from "./demo";
import { blobToBase64, sleep } from "./utils";

const DIRECT_KEY = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
const DIRECT_MODEL = (import.meta.env.VITE_GEMINI_MODEL || "").trim() || "gemini-flash-latest";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/* ───────────────────────── errors ───────────────────────── */

export type AIErrorCode =
  | "not_configured"
  | "rate_limit"
  | "overloaded"
  | "too_large"
  | "blocked"
  | "auth"
  | "network"
  | "bad_response"
  | "api";

export class AIError extends Error {
  code: AIErrorCode;
  status?: number;
  constructor(code: AIErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

/* ───────────────────────── backend detection ───────────────────────── */

export type BackendKind = "proxy" | "direct" | "none";
export type HealthStatus = "not_configured" | "invalid_key" | "quota_exhausted" | "model_unavailable" | "operational" | "upstream_failure";
export interface BackendInfo {
  kind: BackendKind;
  model?: string;
  status?: HealthStatus;
}

let backendPromise: Promise<BackendInfo> | null = null;
let demoMode = false;

export const isDemo = () => demoMode;
export const setDemoMode = (on: boolean) => {
  demoMode = on;
};

async function doDetect(): Promise<BackendInfo> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("application/json")) {
      const data = (await res.json()) as {
        configured?: boolean;
        model?: string;
        status?: string;
      };
      if (data && data.status === "operational") return { kind: "proxy", model: data.model, status: "operational" };
      if (data && data.configured) {
        return { kind: "none", model: data.model, status: data.status as HealthStatus };
      }
    }
  } catch {
    /* no serverless runtime reachable (e.g. static preview) */
  }
  if (DIRECT_KEY) return { kind: "direct", model: DIRECT_MODEL };
  return { kind: "none" };
}

export function detectBackend(force = false): Promise<BackendInfo> {
  if (!backendPromise || force) backendPromise = doDetect();
  return backendPromise;
}

/* ───────────────────────── low-level request ───────────────────────── */

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GenRequest {
  system?: string;
  parts: Part[];
  schema?: object;
  maxOutputTokens?: number;
}

// Remembered across calls: flipped off if the chosen model rejects the option.
let useResponseSchema = true;

function buildPayload(req: GenRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxOutputTokens ?? 8192 };
  const parts: Part[] = [...req.parts];
  if (req.schema) {
    generationConfig.responseMimeType = "application/json";
    if (useResponseSchema) generationConfig.responseSchema = req.schema;
    else parts.push({ text: `Respond ONLY with valid JSON matching this schema:\n${JSON.stringify(req.schema)}` });
  }
  return {
    ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    contents: [{ role: "user", parts }],
    generationConfig,
  };
}

function upstreamMessage(data: unknown, raw: string): string {
  const d = data as { error?: unknown } | null;
  if (d && typeof d.error === "string") return d.error;
  if (d && d.error && typeof d.error === "object") {
    const m = (d.error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function httpError(status: number, data: unknown, raw: string): AIError {
  const message = upstreamMessage(data, raw);
  const code = (data as { code?: string } | null)?.code;
  if (code === "not_configured" || status === 503) {
    return new AIError("not_configured", "Our AI coach is briefly unavailable. Please try again in a moment.", status);
  }
  if (status === 413) {
    return new AIError(
      "too_large",
      "That recording is a bit too large. Keep answers under 90 seconds and try again.",
      status,
    );
  }
  if (status === 429) {
    return new AIError(
      "rate_limit",
      "The free Gemini quota is busy right now. Wait a minute and retry — it resets quickly.",
      status,
    );
  }
  if (status === 500 || status === 502 || status === 504) {
    return new AIError("overloaded", "Our AI service is busy right now. Please retry in a moment.", status);
  }
  if (status === 401 || status === 403 || (status === 400 && /api key|permission|credential/i.test(message))) {
    console.warn("[careeragent] upstream auth issue:", message);
    return new AIError("auth", "We're having trouble reaching our AI service. Please try again shortly.", status);
  }
  if (status === 404) {
    console.warn("[careeragent] upstream 404:", message);
    return new AIError("not_configured", "Our AI coach is briefly unavailable. Please try again in a moment.", status);
  }
  return new AIError("api", message || "Something went wrong. Please try again.", status);
}

async function rawRequest(payload: Record<string, unknown>, backend: BackendInfo): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 115_000);
  let res: Response;
  try {
    if (backend.kind === "proxy") {
      res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } else {
      res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(backend.model || DIRECT_MODEL)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": DIRECT_KEY },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new AIError(
      "network",
      aborted ? "The AI took too long to respond. Please try again." : "Network error — check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw httpError(res.status, data, raw);
  if (!data) throw new AIError("bad_response", "The AI returned an unreadable response. Please try again.");
  return data;
}

interface GeminiResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

function extractText(data: unknown): string {
  const d = data as GeminiResponse;
  if (d.promptFeedback?.blockReason) {
    throw new AIError("blocked", "Gemini's safety filter blocked this request. Try rephrasing or using different content.");
  }
  const cand = d.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("");
  if (!text.trim()) {
    const reason = cand?.finishReason;
    if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
      throw new AIError("blocked", "Gemini couldn't produce a response for this content. Please try again.");
    }
    throw new AIError("bad_response", "The AI returned an empty response. Please try again.");
  }
  return text;
}

async function generate(req: GenRequest): Promise<string> {
  const backend = await detectBackend();
  if (backend.kind === "none") {
    throw new AIError(
      "not_configured",
      "Our AI coach is briefly unavailable. Please try again in a moment — or explore a sample interview.",
    );
  }
  let retries = 0;
  for (;;) {
    try {
      return extractText(await rawRequest(buildPayload(req), backend));
    } catch (e) {
      if (!(e instanceof AIError)) throw e;
      // Model doesn't support an optional feature → drop it once and retry immediately.
      if (e.code === "api" && e.status === 400) {
        if (useResponseSchema && req.schema && /schema|responseMimeType|response_mime|response_schema/i.test(e.message)) {
          useResponseSchema = false;
          continue;
        }
      }
      if ((e.code === "rate_limit" || e.code === "overloaded") && retries < 2) {
        retries++;
        await sleep(retries === 1 ? 5000 : 12000);
        continue;
      }
      throw e;
    }
  }
}

function parseJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
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
  throw new AIError("bad_response", "The AI returned malformed data. Please try again.");
}

async function generateJson(req: GenRequest): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    const text = await generate(req);
    try {
      return parseJson(text);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/* ───────────────────────── public API ───────────────────────── */

export async function importJob(url: string): Promise<{ title: string; company: string; text: string }> {
  let res: Response;
  try {
    res = await fetch("/api/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new AIError("network", "Network error while fetching the job link.");
  }
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new AIError("api", "Link import isn't available right now — please paste the job text instead.");
  }
  const data = (await res.json().catch(() => null)) as { title?: string; company?: string; text?: string; error?: string } | null;
  if (!res.ok || !data || !data.text) {
    throw new AIError("api", data?.error || "Couldn't import that link. Paste the job text instead.");
  }
  return { title: data.title || "", company: data.company || "", text: data.text };
}

export async function extractResumeFromPdf(file: Blob): Promise<string> {
  if (demoMode) {
    await sleep(700);
    return "(Sample preview) PDF reading is available in live sessions. For now, paste your resume text below.";
  }
  const data = await blobToBase64(file);
  const text = await generate({
    parts: [{ inlineData: { mimeType: "application/pdf", data } }, { text: PDF_EXTRACT_PROMPT }],
    maxOutputTokens: 8192,
  });
  return text.replace(/^```(?:\w+)?\s*/i, "").replace(/```\s*$/, "").trim();
}

export async function tailorResume(job: string, resume: string): Promise<TailorResult> {
  if (demoMode) return demoTailor(job, resume);
  const raw = await generateJson({
    system: TAILOR_SYSTEM,
    parts: [{ text: tailorPrompt(job, resume) }],
    schema: TAILOR_SCHEMA,
    maxOutputTokens: 16384,
  });
  return normalizeTailor(raw);
}

export async function generateQuestions(job: string, resumeMd: string, jobTitle: string): Promise<Question[]> {
  if (demoMode) return demoQuestions(jobTitle);
  const raw = await generateJson({
    system: QUESTIONS_SYSTEM,
    parts: [{ text: questionsPrompt(job, resumeMd, jobTitle) }],
    schema: QUESTIONS_SCHEMA,
    maxOutputTokens: 8192,
  });
  return normalizeQuestions(raw);
}

export interface AnalyzeArgs {
  question: Question;
  index: number;
  job: string;
  resume: string;
  jobTitle: string;
  blob: Blob;
  mime: string;
  durationSec: number;
}

export async function analyzeAnswer(a: AnalyzeArgs): Promise<AnswerAnalysis> {
  if (demoMode) return demoAnalysis(a.durationSec, a.index);
  if (a.blob.size < 1500) {
    throw new AIError("api", "That recording looks empty. Check your camera and microphone, then try again.");
  }
  const data = await blobToBase64(a.blob);
  const mimeType = (a.mime.split(";")[0] || "video/webm").trim();
  const raw = await generateJson({
    system: ANALYZE_SYSTEM,
    parts: [
      { inlineData: { mimeType, data } },
      {
        text: analyzePrompt({
          question: a.question.question,
          category: a.question.category,
          intent: a.question.intent,
          jobTitle: a.jobTitle,
          job: a.job,
          resume: a.resume,
          durationSec: a.durationSec,
        }),
      },
    ],
    schema: ANALYZE_SCHEMA,
    maxOutputTokens: 8192,
  });
  return normalizeAnalysis(raw, a.durationSec);
}

/** Never throws: falls back to a locally computed summary if the AI call fails. */
export async function summarizeSession(
  jobTitle: string,
  questions: Question[],
  analyses: (AnswerAnalysis | null)[],
): Promise<SessionSummary> {
  const local = buildLocalSummary(analyses);
  if (demoMode) return local;
  try {
    const digest = JSON.stringify(
      analyses
        .map((a, i) =>
          a
            ? {
                question: questions[i]?.question,
                content: a.contentScore,
                delivery: a.deliveryScore,
                bodyLanguage: a.bodyScore,
                star: a.star,
                fillerWords: a.fillerTotal,
                wpm: a.wpm,
                eyeContact: a.eyeContact,
                strengths: a.strengths.slice(0, 2),
                improvements: a.improvements.slice(0, 2),
              }
            : null,
        )
        .filter(Boolean),
    );
    const raw = await generateJson({
      system: SUMMARY_SYSTEM,
      parts: [{ text: summaryPrompt(jobTitle, digest) }],
      schema: SUMMARY_SCHEMA,
      maxOutputTokens: 4096,
    });
    return normalizeSummary(raw) ?? local;
  } catch {
    return local;
  }
}
