export type Stage = "setup" | "review" | "lobby" | "interview" | "analyzing" | "results";

export interface TailorResult {
  jobTitle: string;
  company: string;
  atsBefore: number;
  atsAfter: number;
  resumeMarkdown: string;
  matchedKeywords: string[];
  addedKeywords: string[];
  missingSkills: string[];
  changes: string[];
}

export interface Question {
  id: number;
  category: string;
  question: string;
  intent: string;
  keyPoints: string[];
}

export interface FillerCount {
  word: string;
  count: number;
}

export type EyeContact = "poor" | "fair" | "good" | "excellent";

export interface AnswerAnalysis {
  transcript: string;
  contentScore: number;
  deliveryScore: number;
  bodyScore: number;
  overall: number;
  star: { situation: boolean; task: boolean; action: boolean; result: boolean };
  fillerWords: FillerCount[];
  fillerTotal: number;
  wpm: number | null;
  eyeContact: EyeContact;
  bodyNotes: string[];
  strengths: string[];
  improvements: string[];
  suggestedRewrite: string;
}

export interface SessionSummary {
  headline: string;
  summary: string;
  topStrengths: string[];
  topImprovements: string[];
  nextSteps: string[];
}

export interface SavedAnswer {
  analysis: AnswerAnalysis;
  durationSec: number;
}

export interface SessionRecord {
  id: string;
  createdAt: number;
  jobTitle: string;
  company: string;
  overall: number;
  content: number;
  delivery: number;
  body: number;
  fillerTotal: number;
  avgWpm: number | null;
  atsBefore: number;
  atsAfter: number;
  summary: SessionSummary;
  questions: Question[];
  answers: (SavedAnswer | null)[];
  resumeMarkdown: string;
  demo: boolean;
}

export type AnswerStatus = "analyzing" | "done" | "error";

export interface AnswerRecord {
  questionId: number;
  blob: Blob;
  mime: string;
  durationSec: number;
  status: AnswerStatus;
  analysis?: AnswerAnalysis;
  error?: string;
}
