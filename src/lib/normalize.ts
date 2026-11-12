/* Defensive normalisers: whatever shape the model returns, the UI always gets safe data. */
import type { AnswerAnalysis, EyeContact, FillerCount, Question, SessionSummary, TailorResult } from "../types";
import { clamp, wordCount } from "./utils";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export function toStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

export function toScore(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  // Be forgiving if a model answers on a 0-1 scale (e.g. 0.85 → 85).
  const scaled = n > 0 && n <= 1 && !Number.isInteger(n) ? n * 100 : n;
  return Math.round(clamp(scaled, 0, 100));
}

export function toStrArray(v: unknown, max = 8): string[] {
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => toStr(x))
    .filter(Boolean)
    .slice(0, max);
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|1)$/i.test(v.trim());
  return false;
}

export function normalizeTailor(raw: unknown): TailorResult {
  const o = isObj(raw) ? raw : {};
  const resumeMarkdown = toStr(o.resumeMarkdown).replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (resumeMarkdown.length < 80) throw new Error("The AI returned an empty resume. Please try again.");
  const before = toScore(o.atsBefore, 50);
  const after = Math.max(toScore(o.atsAfter, Math.min(95, before + 20)), before);
  return {
    jobTitle: toStr(o.jobTitle, "Target role"),
    company: toStr(o.company),
    atsBefore: before,
    atsAfter: Math.min(after, 98),
    resumeMarkdown,
    matchedKeywords: toStrArray(o.matchedKeywords, 14),
    addedKeywords: toStrArray(o.addedKeywords, 14),
    missingSkills: toStrArray(o.missingSkills, 8),
    changes: toStrArray(o.changes, 8),
  };
}

const CATEGORIES = ["Behavioral", "Technical", "Situational", "Role-specific"];

function normCategory(v: unknown): string {
  const s = toStr(v).toLowerCase();
  if (s.startsWith("behav")) return "Behavioral";
  if (s.startsWith("tech")) return "Technical";
  if (s.startsWith("sit")) return "Situational";
  if (s.startsWith("role")) return "Role-specific";
  return CATEGORIES[0];
}

export function normalizeQuestions(raw: unknown): Question[] {
  const list = isObj(raw) && Array.isArray(raw.questions) ? raw.questions : Array.isArray(raw) ? raw : [];
  const questions: Question[] = [];
  for (const item of list) {
    const q = isObj(item) ? toStr(item.question) : toStr(item);
    if (q.length < 10) continue;
    const o = isObj(item) ? item : {};
    questions.push({
      id: questions.length,
      category: normCategory(o.category),
      question: q,
      intent: toStr(o.intent, "Assesses how well your experience fits this role."),
      keyPoints: toStrArray(o.keyPoints, 4),
    });
    if (questions.length === 5) break;
  }
  if (questions.length < 3) throw new Error("The AI didn't return enough interview questions. Please try again.");
  return questions;
}

const FILLER_CLEAN = /[^a-z' ]/g;

function normalizeFillers(v: unknown): FillerCount[] {
  if (!Array.isArray(v)) return [];
  const map = new Map<string, number>();
  for (const item of v) {
    if (!isObj(item)) continue;
    const word = toStr(item.word).toLowerCase().replace(FILLER_CLEAN, "").trim();
    const count = Math.round(typeof item.count === "number" ? item.count : parseFloat(String(item.count)));
    if (!word || !Number.isFinite(count) || count <= 0 || word.length > 20) continue;
    map.set(word, (map.get(word) ?? 0) + Math.min(count, 99));
  }
  return [...map.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function normEye(v: unknown): EyeContact {
  const s = toStr(v).toLowerCase();
  if (s.startsWith("exc")) return "excellent";
  if (s.startsWith("good")) return "good";
  if (s.startsWith("poor") || s.startsWith("bad")) return "poor";
  return "fair";
}

export function computeOverall(content: number, delivery: number, body: number): number {
  return Math.round(content * 0.5 + delivery * 0.3 + body * 0.2);
}

export function normalizeAnalysis(raw: unknown, durationSec: number): AnswerAnalysis {
  const o = isObj(raw) ? raw : {};
  const star = isObj(o.star) ? o.star : {};
  const transcript = toStr(o.transcript);
  const content = toScore(o.contentScore, 50);
  const delivery = toScore(o.deliveryScore, 50);
  const body = toScore(o.bodyLanguageScore, 50);
  const fillerWords = normalizeFillers(o.fillerWords);
  const words = wordCount(transcript);
  const wpm = durationSec >= 6 && words >= 8 ? Math.round((words / durationSec) * 60) : null;
  return {
    transcript,
    contentScore: content,
    deliveryScore: delivery,
    bodyScore: body,
    overall: computeOverall(content, delivery, body),
    star: {
      situation: toBool(star.situation),
      task: toBool(star.task),
      action: toBool(star.action),
      result: toBool(star.result),
    },
    fillerWords,
    fillerTotal: fillerWords.reduce((sum, f) => sum + f.count, 0),
    wpm,
    eyeContact: normEye(o.eyeContact),
    bodyNotes: toStrArray(o.bodyLanguageNotes, 5),
    strengths: toStrArray(o.strengths, 4),
    improvements: toStrArray(o.improvements, 4),
    suggestedRewrite: toStr(o.suggestedRewrite),
  };
}

export function normalizeSummary(raw: unknown): SessionSummary | null {
  if (!isObj(raw)) return null;
  const summary = toStr(raw.summary);
  const topStrengths = toStrArray(raw.topStrengths, 4);
  const topImprovements = toStrArray(raw.topImprovements, 4);
  if (!summary || !topStrengths.length || !topImprovements.length) return null;
  return {
    headline: toStr(raw.headline, "Interview complete"),
    summary,
    topStrengths,
    topImprovements,
    nextSteps: toStrArray(raw.nextSteps, 4),
  };
}
