import { describe, expect, it } from "vitest";
import { normalizeAnalysis, normalizeQuestions, normalizeSummary, normalizeTailor } from "./normalize";
import type { AnswerAnalysis, SessionSummary } from "../types";

describe("normalizeTailor", () => {
  it("normalizes a complete valid tailoring result", () => {
    const raw = {
      jobTitle: "Senior Frontend Engineer",
      company: "Acme Corp",
      atsBefore: 48,
      atsAfter: 86,
      resumeMarkdown: "# Jane Doe\n\n## Summary\nExperienced engineer.\n\n## Experience\n### Senior Engineer — Acme | 2020 - 2024\n- Built stuff\n",
      matchedKeywords: ["React", "TypeScript"],
      addedKeywords: ["GraphQL"],
      missingSkills: ["Java"],
      changes: ["Rewrote summary", "Added keywords"],
    };
    const result = normalizeTailor(raw);
    expect(result.jobTitle).toBe("Senior Frontend Engineer");
    expect(result.company).toBe("Acme Corp");
    expect(result.atsBefore).toBe(48);
    expect(result.atsAfter).toBe(86);
    expect(result.resumeMarkdown).toContain("# Jane Doe");
    expect(result.matchedKeywords).toEqual(["React", "TypeScript"]);
    expect(result.addedKeywords).toEqual(["GraphQL"]);
    expect(result.missingSkills).toEqual(["Java"]);
    expect(result.changes).toEqual(["Rewrote summary", "Added keywords"]);
  });

  it("clamps atsAfter to <= 98 and never below atsBefore", () => {
    const raw = {
      jobTitle: "Role",
      company: "",
      atsBefore: 90,
      atsAfter: 120,
      resumeMarkdown: "# Name\n\n## Summary\nA long enough resume markdown body to pass the minimum length check here.\n\n## Experience\n### Role — Co | 2020 - 2024\n- Did things\n",
    };
    const result = normalizeTailor(raw);
    expect(result.atsAfter).toBe(98);
    expect(result.atsAfter).toBeGreaterThanOrEqual(result.atsBefore);
  });

  it("throws when the resume is empty or too short", () => {
    expect(() => normalizeTailor({ resumeMarkdown: "too short", jobTitle: "x", company: "" } as any)).toThrow();
  });

  it("throws a clean error for an empty / short resume (never crashes on null input)", () => {
    expect(() => normalizeTailor(null as unknown)).toThrow(/empty resume/);
    expect(() => normalizeTailor({ resumeMarkdown: "too short", jobTitle: "x", company: "" } as any)).toThrow(
      /empty resume/,
    );
  });
});

describe("normalizeQuestions", () => {
  it("normalizes five questions with categories", () => {
    const raw = {
      questions: [
        { category: "Behavioral", question: "Tell me about a challenge.", intent: "Tests resilience.", keyPoints: ["a", "b", "c"] },
        { category: "technical", question: "How do you debug?", intent: "Tests debugging.", keyPoints: ["x"] },
        { category: "Situational", question: "First 90 days?", intent: "Tests planning.", keyPoints: ["p"] },
        { category: "Role-specific", question: "Trade-offs?", intent: "Tests judgement.", keyPoints: ["j"] },
        { category: "Behavioral", question: "Conflict with teammate?", intent: "Tests collaboration.", keyPoints: ["c"] },
      ],
    };
    const result = normalizeQuestions(raw);
    expect(result).toHaveLength(5);
    expect(result[0].category).toBe("Behavioral");
    expect(result[1].category).toBe("Technical");
    expect(result[2].category).toBe("Situational");
    expect(result[3].category).toBe("Role-specific");
    expect(result[4].question).toBe("Conflict with teammate?");
  });

  it("throws when fewer than 3 usable questions are returned", () => {
    expect(() => normalizeQuestions({ questions: [{ question: "hi" } as any] } as any)).toThrow();
  });

  it("returns empty-safe result for a plain array", () => {
    const result = normalizeQuestions([
      { question: "One long enough question here", category: "Behavioral", intent: "i", keyPoints: ["a"] } as any,
      { question: "Two long enough question here", category: "Technical", intent: "i", keyPoints: ["a"] } as any,
      { question: "Three long enough question here", category: "Situational", intent: "i", keyPoints: ["a"] } as any,
    ]);
    expect(result).toHaveLength(3);
  });
});

describe("normalizeAnalysis", () => {
  const base = (overrides: Record<string, unknown> = {}): AnswerAnalysis => ({
    transcript: "I built a dashboard with React and TypeScript at my last job.",
    contentScore: 80,
    deliveryScore: 70,
    bodyScore: 60,
    bodyLanguageScore: 60,
    star: { situation: true, task: true, action: true, result: true },
    fillerWords: [{ word: "um", count: 2 }, { word: "like", count: 1 }],
    eyeContact: "good",
    bodyLanguageNotes: ["Good posture."],
    strengths: ["Clear structure."],
    improvements: ["Slow down."],
    suggestedRewrite: "I built a dashboard.",
    ...overrides,
  }) as unknown as AnswerAnalysis;

  it("computes overall, fillerTotal and wpm", () => {
    const result = normalizeAnalysis(base({}), 60);
    expect(result.overall).toBe(Math.round(80 * 0.5 + 70 * 0.3 + 60 * 0.2));
    expect(result.fillerTotal).toBe(3);
    expect(result.wpm).toBe(12);
    expect(result.star).toEqual({ situation: true, task: true, action: true, result: true });
    expect(result.eyeContact).toBe("good");
  });

  it("scales 0-1 scores to 0-100", () => {
    const result = normalizeAnalysis(base({ contentScore: 0.85, deliveryScore: 0.7, bodyLanguageScore: 0.6 }), 60);
    expect(result.contentScore).toBe(85);
    expect(result.deliveryScore).toBe(70);
  });

  it("normalizes eye contact aliases", () => {
    expect(normalizeAnalysis(base({ eyeContact: "excellent" as any }), 10).eyeContact).toBe("excellent");
    expect(normalizeAnalysis(base({ eyeContact: "bad" as any }), 10).eyeContact).toBe("poor");
    expect(normalizeAnalysis(base({ eyeContact: "okay" as any }), 10).eyeContact).toBe("fair");
  });

  it("handles missing filler words and short transcripts", () => {
    const result = normalizeAnalysis(base({ fillerWords: [], transcript: "hi" }), 2);
    expect(result.fillerTotal).toBe(0);
    expect(result.wpm).toBeNull();
  });
});

describe("normalizeSummary", () => {
  it("normalizes a complete summary", () => {
    const raw = {
      headline: "Strong performance",
      summary: "You did well overall.",
      topStrengths: ["a", "b", "c"],
      topImprovements: ["x", "y", "z"],
      nextSteps: ["n1", "n2", "n3"],
    };
    const result = normalizeSummary(raw);
    expect(result).toEqual({
      headline: "Strong performance",
      summary: "You did well overall.",
      topStrengths: ["a", "b", "c"],
      topImprovements: ["x", "y", "z"],
      nextSteps: ["n1", "n2", "n3"],
    } as SessionSummary);
  });

  it("returns null for incomplete input", () => {
    expect(normalizeSummary({ headline: "x" } as any)).toBeNull();
    expect(normalizeSummary(null as unknown)).toBeNull();
  });
});
