/* Prompts + JSON schemas for every Gemini call the app makes. */

const str = (description?: string) => ({ type: "STRING", description });
const int = (description?: string) => ({ type: "INTEGER", description });
const bool = (description?: string) => ({ type: "BOOLEAN", description });
const arr = (items: object, description?: string) => ({ type: "ARRAY", items, description });
const obj = (properties: Record<string, object>, required?: string[]) => ({
  type: "OBJECT",
  properties,
  required: required ?? Object.keys(properties),
});

export const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) + "\n[…truncated]" : text);

/* ───────────────────────── 1. Resume tailoring ───────────────────────── */

export const TAILOR_SYSTEM = `You are a senior technical recruiter and ATS (Applicant Tracking System) optimization expert who writes resumes that get interviews.

Your job: rewrite the candidate's resume so it matches the target job as strongly as honestly possible.

HARD RULES
- NEVER invent employers, titles, dates, degrees, certifications, tools, or metrics. Only use facts present in the original resume. You may reword, reorder, merge, tighten and emphasise.
- If the job requires skills the candidate does not have, do NOT add them to the resume — list them in "missingSkills" instead.
- Mirror the job description's exact terminology where the candidate genuinely has that experience (e.g. use "CI/CD" if the posting says CI/CD and the resume says "deployment pipelines").
- Start each bullet with a strong action verb, lead with impact, keep bullets to 1–2 lines. Keep numbers/metrics that exist in the original.
- Put the most relevant experience, skills and keywords first. Write a 2–3 line professional summary aimed at this exact role.
- Keep it to a realistic 1–2 page length. No tables, no emojis, no code fences, no commentary inside the resume.

OUTPUT FORMAT for "resumeMarkdown" (Markdown only):
# Full Name
Contact line (email · phone · city · links) on one line
## Summary
## Skills        (grouped lines like "**Languages:** …")
## Experience    (each role: "### Job Title — Company | Dates" then "- " bullets)
## Projects      (only if present in the original)
## Education
## Certifications (only if present)

SCORING
- "atsBefore": honest 0-100 keyword/requirements match of the ORIGINAL resume vs the job.
- "atsAfter": honest 0-100 match of YOUR rewritten resume (never above 97).`;

export const TAILOR_SCHEMA = obj({
  jobTitle: str("The target job title from the posting"),
  company: str("Company name, or empty string if unknown"),
  atsBefore: int("0-100"),
  atsAfter: int("0-100"),
  matchedKeywords: arr(str(), "Important job keywords the candidate already covers (max 12)"),
  addedKeywords: arr(str(), "Job keywords now surfaced in the rewritten resume that were weak/absent before (max 12)"),
  missingSkills: arr(str(), "Required skills the candidate genuinely lacks (max 6)"),
  changes: arr(str(), "3-6 short sentences describing the most important changes you made"),
  resumeMarkdown: str("The full rewritten resume in Markdown"),
});

export function tailorPrompt(job: string, resume: string) {
  return `TARGET JOB DESCRIPTION:\n"""\n${clip(job, 12000)}\n"""\n\nCANDIDATE'S CURRENT RESUME:\n"""\n${clip(resume, 14000)}\n"""\n\nRewrite and score now.`;
}

/* ───────────────────────── 2. PDF → text ───────────────────────── */

export const PDF_EXTRACT_PROMPT = `Extract the full text of this resume document faithfully. Preserve section order and bullet points (use "- " for bullets, and blank lines between sections). Do not summarise, translate, add commentary, or invent anything. Output only the resume text.`;

/* ───────────────────────── 3. Interview questions ───────────────────────── */

export const QUESTIONS_SYSTEM = `You are a sharp, experienced hiring manager running a real interview. You never ask generic questions such as "tell me about yourself" or "what are your weaknesses".

Write exactly 5 interview questions personalised to THIS candidate and THIS job:
1. Behavioral (STAR-style) — probe a specific project, employer or achievement visible in the resume.
2. Behavioral — about conflict, failure, ambiguity or influence, tied to the job's culture/responsibilities.
3. Technical / role-specific — test a core requirement of the job using the candidate's own stack or domain.
4. Technical / role-specific — a deeper "how would you" or trade-off question for a likely real challenge in this role.
5. Situational — a realistic first-90-days scenario at this company/role, or a gap/transition in the resume.

RULES
- Reference concrete details (employer names, technologies, projects, numbers) from the resume or job posting.
- Each question must be natural spoken English, max 45 words, answerable in 60–90 seconds, one question only (no multi-part lists).
- "intent" = one sentence on what the interviewer is really testing.
- "keyPoints" = 3 short bullets of what a strong answer would cover.
- "category" must be one of: Behavioral, Technical, Situational, Role-specific.`;

export const QUESTIONS_SCHEMA = obj({
  questions: arr(
    obj({
      category: str("Behavioral | Technical | Situational | Role-specific"),
      question: str("The question exactly as the interviewer would say it aloud"),
      intent: str("What the interviewer is testing"),
      keyPoints: arr(str(), "3 things a strong answer covers"),
    }),
  ),
});

export function questionsPrompt(job: string, resume: string, jobTitle: string) {
  return `TARGET ROLE: ${jobTitle || "(see job description)"}\n\nJOB DESCRIPTION:\n"""\n${clip(job, 9000)}\n"""\n\nCANDIDATE'S TAILORED RESUME:\n"""\n${clip(resume, 9000)}\n"""\n\nWrite the 5 questions now.`;
}

/* ───────────────────────── 4. Answer analysis (video + audio) ───────────────────────── */

export const ANALYZE_SYSTEM = `You are an expert interview coach evaluating a recorded VIDEO answer. You can both see and hear the candidate. Be honest, specific and constructive — not flattering. Typical answers score 55–75; reserve 85+ for genuinely excellent ones.

Evaluate three dimensions, each scored 0-100:
1. contentScore — relevance to the question, specificity, STAR structure (Situation, Task, Action, Result), quantified impact, alignment with the job and the candidate's resume, and honesty.
2. deliveryScore — vocal delivery: clarity, confident tone, pacing, pauses, energy, filler words ("um", "uh", "like", "you know", "basically", "actually", "sort of").
3. bodyLanguageScore — visual presence: eye contact with the camera, posture, facial expressiveness/smiling, fidgeting or distracting movement, framing and lighting.

RULES
- "transcript": transcribe VERBATIM what the candidate said, INCLUDING filler words like um/uh. If there is no intelligible speech, return an empty string and score content and delivery very low (≤ 15).
- "fillerWords": count each filler word you actually hear in the audio (lowercase). Empty list if none.
- "star": true only if that STAR element is clearly present in the answer.
- "eyeContact": one of poor, fair, good, excellent (judge how often they look at the camera lens).
- "bodyLanguageNotes": 2-4 short, concrete visual observations (e.g. "Looked down-left when thinking", "Warm smile at the start"). If no face is visible, say so and score bodyLanguageScore around 40.
- "strengths": 2-3 specific things done well. "improvements": 2-3 specific, actionable fixes.
- "suggestedRewrite": a stronger first-person version of THEIR answer (max 150 words), STAR-structured, spoken style. Use only facts the candidate said or that appear in their resume — never invent metrics or employers.
- Write feedback addressed to the candidate ("you").`;

export const ANALYZE_SCHEMA = obj({
  transcript: str("Verbatim transcript including filler words"),
  contentScore: int("0-100"),
  deliveryScore: int("0-100"),
  bodyLanguageScore: int("0-100"),
  star: obj({
    situation: bool(),
    task: bool(),
    action: bool(),
    result: bool(),
  }),
  fillerWords: arr(obj({ word: str(), count: int() }), "Filler words heard with counts"),
  eyeContact: str("poor | fair | good | excellent"),
  bodyLanguageNotes: arr(str(), "2-4 visual observations"),
  strengths: arr(str(), "2-3 items"),
  improvements: arr(str(), "2-3 items"),
  suggestedRewrite: str("Improved first-person answer, max 150 words"),
});

export function analyzePrompt(args: {
  question: string;
  category: string;
  intent: string;
  jobTitle: string;
  job: string;
  resume: string;
  durationSec: number;
}) {
  return `The attached video is the candidate's answer to this interview question.

ROLE: ${args.jobTitle || "(see job description)"}
QUESTION (${args.category}): "${args.question}"
WHAT THE INTERVIEWER IS TESTING: ${args.intent}
ANSWER LENGTH: ${Math.round(args.durationSec)} seconds

JOB DESCRIPTION (for context):
"""
${clip(args.job, 3500)}
"""

CANDIDATE'S RESUME (for context):
"""
${clip(args.resume, 3500)}
"""

Watch and listen to the video, then return your evaluation.`;
}

/* ───────────────────────── 5. Session summary (text only) ───────────────────────── */

export const SUMMARY_SYSTEM = `You are an encouraging but honest interview coach writing the headline feedback for a mock interview scorecard. Be specific, reference what actually happened in the answers, and keep each item to one sentence. Address the candidate as "you".`;

export const SUMMARY_SCHEMA = obj({
  headline: str("A punchy 4-8 word verdict, no emojis"),
  summary: str("2-3 sentence overall assessment"),
  topStrengths: arr(str(), "Exactly 3 strengths across the whole interview"),
  topImprovements: arr(str(), "Exactly 3 highest-impact improvements"),
  nextSteps: arr(str(), "Exactly 3 concrete practice actions for the next attempt"),
});

export function summaryPrompt(jobTitle: string, digest: string) {
  return `ROLE: ${jobTitle || "the target role"}\n\nPER-ANSWER RESULTS (JSON):\n${digest}\n\nWrite the scorecard feedback now.`;
}
