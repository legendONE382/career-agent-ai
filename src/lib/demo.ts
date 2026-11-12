/* Demo mode: simulated AI so the whole flow can be explored without an API key. */
import type { AnswerAnalysis, Question, TailorResult } from "../types";
import { sleep } from "./utils";

export const SAMPLE_JOB = `Senior Frontend Engineer — Lumen Analytics (Remote, US)

About the role
We're building the next generation of data visualisation tools for finance teams. You'll own major parts of our React + TypeScript web app, partner closely with design and product, and mentor other engineers.

What you'll do
- Design and ship performant, accessible UI features in React and TypeScript
- Own front-end architecture, state management and testing strategy
- Improve Core Web Vitals and build reusable design-system components
- Collaborate with backend engineers on GraphQL APIs
- Mentor mid-level engineers and lead code reviews

What we're looking for
- 5+ years of professional front-end experience with React and TypeScript
- Experience with testing (Jest, React Testing Library, Cypress)
- Strong understanding of performance optimisation, accessibility (WCAG) and CI/CD
- Experience with GraphQL, data visualisation (D3, Recharts) a big plus
- Excellent communication; comfortable working with cross-functional partners`;

export const SAMPLE_RESUME = `Jordan Rivera
jordan.rivera@email.com · (555) 013-2288 · Austin, TX · github.com/jrivera

SUMMARY
Front-end developer with 6 years of experience building web apps for startups and mid-size companies.

EXPERIENCE
Front-End Developer — BrightPath Software, Austin TX (2021 – Present)
- Built customer dashboard in React and TypeScript used by 40k monthly users
- Cut page load time by 38% by splitting bundles and lazy loading charts
- Wrote unit tests with Jest and React Testing Library, raising coverage from 40% to 82%
- Worked with backend team on GraphQL queries and caching
- Mentored two junior developers and ran weekly code reviews

Web Developer — Pixel & Co, Dallas TX (2018 – 2021)
- Developed marketing sites and e-commerce features in JavaScript and Vue
- Set up GitHub Actions pipelines to automate deploys
- Fixed accessibility issues found in audits, improving Lighthouse a11y score from 71 to 96

SKILLS
React, TypeScript, JavaScript, Vue, GraphQL, Jest, Cypress, GitHub Actions, HTML, CSS, Recharts

EDUCATION
B.S. Computer Science — University of Texas at Dallas, 2018`;

const STOP = new Set(
  "with that this from your have will they their about into over more than also such other these those been being were what when where which while within without would could should must able work team role join looking experience years strong ability across using used make like help build building including include great plus well need needs highly".split(
    " ",
  ),
);

function keywords(job: string): string[] {
  const counts = new Map<string, number>();
  for (const w of job.toLowerCase().match(/[a-z][a-z0-9+#./-]{2,}/g) ?? []) {
    if (STOP.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28)
    .map(([w]) => w);
}

function textToMarkdown(resume: string): string {
  const lines = resume.split(/\r?\n/).map((l) => l.trimEnd());
  const out: string[] = [];
  let first = true;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push("");
      continue;
    }
    if (first) {
      out.push(`# ${t.replace(/^#+\s*/, "")}`);
      first = false;
    } else if (/^#{1,3}\s/.test(t)) out.push(t);
    else if (/^[•*▪◦-]\s+/.test(t)) out.push(`- ${t.replace(/^[•*▪◦-]\s+/, "")}`);
    else if (/^[A-Z][A-Z &/]{3,}:?$/.test(t)) out.push(`## ${t.replace(/:$/, "")}`);
    else out.push(t);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function demoTailor(job: string, resume: string): Promise<TailorResult> {
  await sleep(1400);
  const kws = keywords(job);
  const lowerResume = resume.toLowerCase();
  const matched = kws.filter((k) => lowerResume.includes(k));
  const missing = kws.filter((k) => !lowerResume.includes(k));
  const title = (job.split(/\r?\n/).find((l) => l.trim()) || "Target role").replace(/\s+[—–-]\s+.*$/, "").trim().slice(0, 70);
  const company = /—\s*([^(\n]+)/.exec(job.split(/\r?\n/)[0] || "")?.[1]?.trim() ?? "";
  const before = Math.min(78, Math.max(38, Math.round((matched.length / Math.max(kws.length, 1)) * 100)));
  const summaryLine = `## Summary\nResults-driven professional targeting the ${title} role, bringing hands-on experience in ${matched
    .slice(0, 5)
    .join(", ") || "the core requirements"} and a track record of shipping measurable improvements.\n`;
  let md = textToMarkdown(resume);
  md = /^## Summary/im.test(md) ? md.replace(/## Summary[\s\S]*?(?=\n## |\n*$)/i, summaryLine.trimEnd() + "\n") : md.replace(/^(# .*\n)/, `$1\n${summaryLine}\n`);
  return {
    jobTitle: title,
    company,
    atsBefore: before,
    atsAfter: Math.min(94, before + 21),
    resumeMarkdown: md,
    matchedKeywords: matched.slice(0, 10),
    addedKeywords: matched.slice(0, 5),
    missingSkills: missing.slice(0, 4),
    changes: [
      "Sample preview: this is a simulated rewrite so you can explore the experience. A live session produces a full, truthful, keyword-optimised resume.",
      "Added a role-specific professional summary that mirrors the job posting's language.",
      "Converted your text into clean, ATS-friendly Markdown sections.",
    ],
  };
}

export async function demoQuestions(jobTitle: string): Promise<Question[]> {
  await sleep(1000);
  const role = jobTitle || "this role";
  const base: Omit<Question, "id">[] = [
    {
      category: "Behavioral",
      question:
        "Walk me through the project on your resume you're proudest of. What was the problem, what did you personally do, and what was the measurable result?",
      intent: "Tests ownership, impact and whether you can tell a structured story.",
      keyPoints: ["Clear problem and stakes", "Your specific actions", "Quantified result"],
    },
    {
      category: "Behavioral",
      question:
        "Tell me about a time you disagreed with a teammate or stakeholder about the right approach. How did you handle it, and what happened?",
      intent: "Probes collaboration, influence and emotional maturity.",
      keyPoints: ["Respectful framing", "Data or user evidence", "Outcome and learning"],
    },
    {
      category: "Role-specific",
      question: `For a ${role} position, what are the first three things you'd want to understand about our product and codebase before making a big technical decision?`,
      intent: "Checks judgement, curiosity and how you ramp up.",
      keyPoints: ["User and business context", "Constraints and tech debt", "Who to talk to"],
    },
    {
      category: "Technical",
      question:
        "Describe a time something you shipped didn't go as planned. How did you find out, what did you do in the moment, and what did you change afterwards?",
      intent: "Assesses accountability, debugging approach and process improvement.",
      keyPoints: ["Fast detection and communication", "Root cause", "Preventive change"],
    },
    {
      category: "Situational",
      question:
        "Imagine it's your thirtieth day here and you've been handed an ambiguous, high-priority problem with no clear owner. How do you approach it?",
      intent: "Evaluates autonomy, prioritisation and communication under ambiguity.",
      keyPoints: ["Clarify the goal", "Break down and de-risk", "Keep stakeholders updated"],
    },
  ];
  return base.map((q, id) => ({ ...q, id }));
}

export async function demoAnalysis(durationSec: number, index: number): Promise<AnswerAnalysis> {
  await sleep(900 + Math.random() * 900);
  const seed = Math.round(durationSec) + index * 7;
  const wobble = (n: number, spread: number) => Math.max(35, Math.min(96, n + ((seed * (n + 3)) % (spread * 2)) - spread));
  const content = wobble(72, 9);
  const delivery = wobble(70, 10);
  const body = wobble(76, 8);
  const fillers = [
    { word: "um", count: 1 + (seed % 4) },
    { word: "like", count: seed % 3 },
    { word: "you know", count: seed % 2 },
  ].filter((f) => f.count > 0);
  return {
    transcript:
      "(Sample preview) In a live session your real, word-for-word transcript appears here — including every “um” and “uh”. This sample text lets you explore the scorecard layout.",
    contentScore: content,
    deliveryScore: delivery,
    bodyScore: body,
    overall: Math.round(content * 0.5 + delivery * 0.3 + body * 0.2),
    star: { situation: true, task: seed % 3 !== 0, action: true, result: seed % 2 === 0 },
    fillerWords: fillers,
    fillerTotal: fillers.reduce((s, f) => s + f.count, 0),
    wpm: 128 + (seed % 38),
    eyeContact: (["fair", "good", "good", "excellent"] as const)[seed % 4],
    bodyNotes: [
      "Steady posture and well-framed shot.",
      "Warm expression at the start — keep it through the answer.",
      "Glanced away while thinking; try looking at the lens when making your key point.",
    ],
    strengths: ["Opened with clear context before diving into detail.", "Used concrete actions instead of vague team-speak."],
    improvements: ["Finish with a quantified result so the impact is unmistakable.", "Trim filler words by pausing silently between thoughts."],
    suggestedRewrite:
      "In my last role I owned a dashboard that was slowing down for 40,000 monthly users. My goal was to cut load time without a rewrite, so I profiled the bundle, split the heavy chart code and lazy-loaded it. Load time dropped 38%, support tickets about slowness fell sharply, and I documented the approach so the team reused it on two other pages.",
  };
}
