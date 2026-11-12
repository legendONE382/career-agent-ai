import type { AnswerAnalysis, Question, SessionRecord, SessionSummary } from "../types";
import { avg } from "./utils";

export interface Tier {
  label: string;
  emoji: string;
  grade: string;
  blurb: string;
}

export function tierFor(score: number): Tier {
  if (score >= 90) return { label: "Hire-Ready", emoji: "🏆", grade: "A+", blurb: "Offer-level performance." };
  if (score >= 80) return { label: "Interview Ace", emoji: "🚀", grade: "A", blurb: "You'd stand out in a real loop." };
  if (score >= 70) return { label: "Strong Contender", emoji: "💪", grade: "B", blurb: "Solid — a few tweaks from great." };
  if (score >= 55) return { label: "Rising Candidate", emoji: "📈", grade: "C", blurb: "Good bones. Practice will show fast." };
  return { label: "Warm-Up Round", emoji: "🌱", grade: "D", blurb: "Everyone starts here. Run it again!" };
}

export function scoreColor(score: number): string {
  if (score >= 80) return "#19a974";
  if (score >= 65) return "#8fbf1c";
  if (score >= 50) return "#f5a524";
  return "#ff6b4a";
}

export interface Aggregate {
  overall: number;
  content: number;
  delivery: number;
  body: number;
  fillerTotal: number;
  avgWpm: number | null;
  starCoverage: number; // 0-1
  fillerBreakdown: { word: string; count: number }[];
}

export function aggregate(items: ({ analysis: AnswerAnalysis; durationSec: number } | null)[]): Aggregate {
  const done = items.filter((x): x is { analysis: AnswerAnalysis; durationSec: number } => !!x);
  if (!done.length) {
    return { overall: 0, content: 0, delivery: 0, body: 0, fillerTotal: 0, avgWpm: null, starCoverage: 0, fillerBreakdown: [] };
  }
  const content = Math.round(avg(done.map((d) => d.analysis.contentScore)));
  const delivery = Math.round(avg(done.map((d) => d.analysis.deliveryScore)));
  const body = Math.round(avg(done.map((d) => d.analysis.bodyScore)));
  const overall = Math.round(avg(done.map((d) => d.analysis.overall)));
  const wpms = done.map((d) => d.analysis.wpm).filter((w): w is number => typeof w === "number");
  const starHits = done.reduce((sum, d) => sum + Object.values(d.analysis.star).filter(Boolean).length, 0);
  const map = new Map<string, number>();
  for (const d of done) for (const f of d.analysis.fillerWords) map.set(f.word, (map.get(f.word) ?? 0) + f.count);
  const fillerBreakdown = [...map.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return {
    overall,
    content,
    delivery,
    body,
    fillerTotal: fillerBreakdown.reduce((s, f) => s + f.count, 0),
    avgWpm: wpms.length ? Math.round(avg(wpms)) : null,
    starCoverage: starHits / (done.length * 4),
    fillerBreakdown,
  };
}

export function paceLabel(wpm: number | null): { label: string; tone: "good" | "warn" | "na" } {
  if (wpm === null) return { label: "n/a", tone: "na" };
  if (wpm < 105) return { label: "A bit slow", tone: "warn" };
  if (wpm > 175) return { label: "Too fast", tone: "warn" };
  return { label: "Great pace", tone: "good" };
}

export interface Badge {
  emoji: string;
  name: string;
  desc: string;
  earned: boolean;
}

export function computeBadges(rec: SessionRecord): Badge[] {
  const agg = aggregate(rec.answers);
  const answered = rec.answers.filter(Boolean).length;
  const totalMin = rec.answers.reduce((s, a) => s + (a ? a.durationSec : 0), 0) / 60;
  const fillerRate = totalMin > 0 ? agg.fillerTotal / totalMin : 0;
  return [
    { emoji: "⭐", name: "STAR Master", desc: "Covered 75%+ of STAR elements", earned: agg.starCoverage >= 0.75 },
    { emoji: "🎙️", name: "Smooth Talker", desc: "Under 2 filler words a minute", earned: answered > 0 && fillerRate < 2 },
    { emoji: "👀", name: "Camera Ready", desc: "Body language score 80+", earned: agg.body >= 80 },
    {
      emoji: "⏱️",
      name: "Perfect Pace",
      desc: "Averaged 115–165 words a minute",
      earned: agg.avgWpm !== null && agg.avgWpm >= 115 && agg.avgWpm <= 165,
    },
    { emoji: "🏁", name: "Finisher", desc: "Answered every question", earned: answered === rec.questions.length && answered > 0 },
  ];
}

export function buildLocalSummary(analyses: (AnswerAnalysis | null)[]): SessionSummary {
  const done = analyses.filter((a): a is AnswerAnalysis => !!a);
  const agg = aggregate(done.map((analysis) => ({ analysis, durationSec: 0 })));
  const dims = [
    { name: "answer content", score: agg.content },
    { name: "vocal delivery", score: agg.delivery },
    { name: "body language", score: agg.body },
  ].sort((a, b) => b.score - a.score);
  const best = dims[0];
  const worst = dims[dims.length - 1];
  const tier = tierFor(agg.overall);
  const strengths = done.flatMap((a) => a.strengths.slice(0, 1)).slice(0, 3);
  const improvements = done.flatMap((a) => a.improvements.slice(0, 1)).slice(0, 3);
  return {
    headline: `${tier.label} — ${agg.overall}/100`,
    summary: `Your strongest area was ${best.name} (${best.score}/100) and your biggest opportunity is ${worst.name} (${worst.score}/100). ${tier.blurb}`,
    topStrengths: strengths.length ? strengths : [`Strong ${best.name}.`],
    topImprovements: improvements.length ? improvements : [`Focus on improving your ${worst.name}.`],
    nextSteps: [
      "Re-record your weakest answer using the suggested rewrite as a guide.",
      "Practise each story out loud with a clear Situation → Task → Action → Result flow.",
      "Pause silently for a beat instead of using filler words.",
    ],
  };
}

export function linkedInPost(rec: SessionRecord, url: string): string {
  const tier = tierFor(rec.overall);
  const role = rec.jobTitle ? ` for a ${rec.jobTitle} role` : "";
  const strength = rec.summary.topStrengths[0];
  const growth = rec.summary.topImprovements[0];
  const lines = [
    `${tier.emoji} I just ran a mock AI interview${role} on CareerAgent.ai and scored ${rec.overall}/100 — "${tier.label}"!`,
    "",
    `📊 Content (STAR): ${rec.content}/100`,
    `🎙️ Vocal delivery: ${rec.delivery}/100`,
    `👀 Body language: ${rec.body}/100`,
    `🎯 Resume ATS match: ${rec.atsBefore}% → ${rec.atsAfter}%`,
    "",
    strength ? `💪 Top strength: ${strength}` : "",
    growth ? `🔧 Working on: ${growth}` : "",
    "",
    "It rewrote my resume for the job, then grilled me on camera and graded my answers, my delivery and my body language. Free, no signup.",
    "",
    `Try it yourself 👉 ${url}`,
    "",
    "#JobSearch #InterviewPrep #AI #CareerGrowth #Hiring",
  ];
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim();
}

export function spokenFeedback(rec: SessionRecord): string {
  const tier = tierFor(rec.overall);
  return [
    `Your overall score is ${rec.overall} out of 100. That makes you a ${tier.label}.`,
    rec.summary.summary,
    `Content scored ${rec.content}. Delivery scored ${rec.delivery}. Body language scored ${rec.body}.`,
    rec.summary.topStrengths[0] ? `Your top strength: ${rec.summary.topStrengths[0]}` : "",
    rec.summary.topImprovements[0] ? `Your top priority to improve: ${rec.summary.topImprovements[0]}` : "",
    rec.summary.nextSteps[0] ? `Next step: ${rec.summary.nextSteps[0]}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function questionLabel(questions: Question[], i: number): string {
  return questions[i]?.question ?? `Question ${i + 1}`;
}
