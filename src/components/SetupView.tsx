import { useRef, useState, type DragEvent } from "react";
import type { SessionRecord } from "../types";
import type { BackendInfo } from "../lib/gemini";
import { errorMessage, extractResumeFromPdf, importJob } from "../lib/gemini";
import mammoth from "mammoth";
import { SAMPLE_JOB, SAMPLE_RESUME } from "../lib/demo";
import { tierFor, scoreColor } from "../lib/scoring";
import { formatDate } from "../lib/utils";
import { cn } from "../utils/cn";
import { Button, Chip, ErrorBanner, Eyebrow, Icon, MeterBar, Spinner } from "./ui";

interface Props {
  job: string;
  resume: string;
  onJob: (v: string) => void;
  onResume: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  backend: BackendInfo | null;
  demo: boolean;
  onEnableDemo: () => void;
  onRecheck: () => void;
  sessions: SessionRecord[];
  onOpenSession: (s: SessionRecord) => void;
  onDeleteSession: (id: string) => void;
  onClearSessions: () => void;
  online: boolean;
  onPrivacy: () => void;
  canInstall: boolean;
  onInstall: () => void;
}

const MIN_JOB = 60;
const MIN_RESUME = 100;

const MAX_PDF_BYTES = 2.5 * 1024 * 1024;
const MAX_DOCX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

async function extractTextFromFile(file: File): Promise<string> {
  const ext = fileExt(file.name);

  // MIME sanity check: never treat an image/video/audio as a document.
  const declared = (file.type || "").toLowerCase();
  if (declared && /^(image|video|audio)\//.test(declared)) {
    throw new Error("That looks like an image, video or audio file, not a resume. Upload a PDF, .docx or .txt/.md file instead.");
  }

  if (ext === ".pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("That PDF is over 2.5 MB. Try a smaller file or paste the text.");
    return extractResumeFromPdf(file);
  }

  if (ext === ".docx") {
    if (file.size > MAX_DOCX_BYTES) throw new Error("That Word document is over 8 MB. Try a smaller file or paste the text.");
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    if (result.messages && result.messages.length) {
      // Non-fatal conversion warnings (unknown styles, etc.) — text is still usable.
    }
    return result.value || "";
  }

  if (/\.(txt|md|markdown|text)$/.test(ext)) {
    if (file.size > MAX_TEXT_BYTES) throw new Error("That file is too large to be a resume.");
    return file.text();
  }

  throw new Error("Unsupported file type. Upload a PDF, .docx (Word) or .txt/.md file, or paste your resume below.");
}

export function SetupView(p: Props) {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const jobOk = p.job.trim().length >= MIN_JOB;
  const resumeOk = p.resume.trim().length >= MIN_RESUME;
  const canSubmit = jobOk && resumeOk && !p.loading && !reading;

  async function handleImport() {
    if (!url.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await importJob(url.trim());
      p.onJob(res.text);
    } catch (e) {
      setImportError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      const ext = fileExt(file.name);
      if (!/^\.(pdf|docx|txt|md|markdown|text)$/.test(ext)) {
        throw new Error("Unsupported file type. Upload a PDF, .docx (Word) or .txt/.md file, or paste your resume below.");
      }
      const text = await extractTextFromFile(file);
      if (text.trim().length < 30) throw new Error("Couldn't find readable text in that file. Paste your resume text instead.");
      p.onResume(text.trim());
      setFileName(file.name);
    } catch (e) {
      setFileError(errorMessage(e));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  }

  const needsSetup = !p.demo && p.backend?.kind === "none";
  const trend = [...p.sessions].slice(0, 10).reverse();

  return (
    <div className="animate-fade-in">
      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden border-b border-ink/10">
        <div className="bg-dots absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_70%)]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.15fr_0.85fr] lg:pb-20">
          <div>
            <div className="mb-6 flex flex-wrap gap-2">
              <Chip tone="dark" className="!border-ink/10 !bg-ink !text-lime">
                <Icon name="sparkles" className="size-3" /> 100% free
              </Chip>
              <Chip>No signup</Chip>
              <Chip>No database</Chip>
            </div>
            <h1 className="font-display text-[2.9rem] font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
              Tailor your resume.
              <br />
              Then{" "}
              <span className="relative isolate inline-block">
                <span className="absolute -inset-x-1 bottom-[0.06em] -z-10 h-[0.42em] -rotate-1 rounded-sm bg-lime" aria-hidden="true" />
                survive
              </span>{" "}
              the interview.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/70">
              Paste a job and your resume. CareerAgent rewrites it to beat the ATS, then grills you in a realistic{" "}
              <strong className="font-semibold text-ink">on-camera interview</strong> — and scores your answers, your voice and your body
              language in one go.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => document.getElementById("start")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Start in 10 seconds <Icon name="arrowRight" />
              </Button>
              <button
                onClick={() => {
                  p.onJob(SAMPLE_JOB);
                  p.onResume(SAMPLE_RESUME);
                  setFileName(null);
                  document.getElementById("start")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="rounded-full px-4 py-3 text-sm font-semibold text-ink/70 underline decoration-ink/25 underline-offset-4 hover:text-ink"
              >
                or try sample data
              </button>
            </div>
            <ul className="mt-9 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 text-[13px] font-medium text-ink/60 sm:flex sm:flex-wrap sm:gap-x-7">
              {(
                [
                  ["shield", "Private by design"],
                  ["lock", "No account needed"],
                  ["video", "Works on any device"],
                  ["sparkles", "Powered by Google Gemini"],
                ] as const
              ).map(([icon, label]) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon name={icon} className="size-4 text-ink/45" /> {label}
                </li>
              ))}
            </ul>
          </div>

          {/* Scorecard preview */}
          <div className="relative hidden lg:block" aria-hidden="true">
            <div className="absolute -inset-6 rounded-[2.5rem] bg-lime/40 blur-3xl" />
            <div className="relative animate-float rounded-[2rem] border border-white/10 bg-ink p-7 text-paper shadow-2xl shadow-ink/30">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-lime">Scorecard</span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs">Senior Frontend Eng.</span>
              </div>
              <div className="mt-5 flex items-center gap-6">
                <div className="relative size-32">
                  <svg viewBox="0 0 120 120" className="-rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="12" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#c8f560" strokeWidth="12" strokeLinecap="round" strokeDasharray="314" strokeDashoffset="41" />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center font-display text-4xl font-extrabold">87</div>
                </div>
                <div>
                  <p className="font-display text-2xl font-bold">🚀 Interview Ace</p>
                  <p className="mt-1 text-sm text-paper/60">ATS match 54% → 91%</p>
                </div>
              </div>
              <div className="mt-6 space-y-3 text-sm">
                {[
                  ["Content (STAR)", 91, "#19a974"],
                  ["Vocal delivery", 82, "#19a974"],
                  ["Body language", 79, "#8fbf1c"],
                ].map(([label, v, c]) => (
                  <div key={label as string}>
                    <div className="mb-1 flex justify-between text-paper/70">
                      <span>{label}</span>
                      <span className="font-mono">{v}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${v}%`, background: c as string }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-white/10 px-2.5 py-1">⭐ STAR Master</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1">🎙️ Smooth Talker</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1">👀 Camera Ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Availability notice (user-facing, no technical detail) ───────── */}
      {needsSetup && (
        <section className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
          <div className="rounded-3xl border border-amber/40 bg-amber/10 p-6 sm:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex max-w-2xl items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber/25">
                  <Icon name={p.online ? "clock" : "alert"} className="size-5 text-[#8a5a00]" />
                </span>
                <div>
                  <p className="font-display text-xl font-bold">
                    {p.online ? "Our AI coach is briefly unavailable" : "You're offline"}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink/75">
                    {p.online
                      ? "We're reconnecting automatically — this usually takes less than a minute. You can also explore a sample interview to see exactly how CareerAgent works."
                      : "Your saved scorecards still work. Reconnect to the internet to tailor resumes and run interviews."}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={p.onRecheck}>
                  <Icon name="refresh" /> Try again
                </Button>
                <Button size="sm" onClick={p.onEnableDemo}>
                  Explore a sample interview
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────── Form ───────── */}
      <section id="start" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-12 sm:px-6">
        <div className="mb-8 flex flex-col gap-1">
          <Eyebrow>Step 1 of 3</Eyebrow>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Give your agent something to work with</h2>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Job */}
          <div className="flex min-w-0 flex-col rounded-3xl border border-ink/10 bg-white/60 p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-ink font-mono text-sm text-lime">1</span>
              <div>
                <h3 className="font-display text-xl font-bold leading-tight">The job</h3>
                <p className="text-[13px] text-ink/55">Paste the posting — or import it from a link.</p>
              </div>
            </div>

            <div className="mb-3 flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Job posting URL</span>
                <Icon name="link" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40" />
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleImport()}
                  placeholder="https://company.com/careers/role"
                  className="w-full rounded-full border border-ink/12 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-ink focus:ring-4 focus:ring-lime/50"
                />
              </label>
              <Button variant="secondary" size="md" onClick={() => void handleImport()} disabled={!url.trim()} loading={importing}>
                Import
              </Button>
            </div>
            {importError && <p className="mb-3 rounded-xl bg-coral/10 px-3 py-2 text-[13px] text-[#8f2a14]">{importError}</p>}

            <textarea
              value={p.job}
              onChange={(e) => p.onJob(e.target.value)}
              placeholder="Paste the full job description here — responsibilities, requirements, about the company…"
              aria-label="Job description"
              className="min-h-[300px] w-full flex-1 resize-y rounded-2xl border border-ink/12 bg-white p-4 text-sm leading-relaxed outline-none transition focus:border-ink focus:ring-4 focus:ring-lime/50"
            />
            <p className={cn("mt-2 text-xs", jobOk ? "text-mint" : "text-ink/45")}>
              {jobOk ? "✓ Looks good" : `${p.job.trim().length}/${MIN_JOB}+ characters`}
            </p>
          </div>

          {/* Resume */}
          <div className="flex min-w-0 flex-col rounded-3xl border border-ink/10 bg-white/60 p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-ink font-mono text-sm text-lime">2</span>
              <div>
                <h3 className="font-display text-xl font-bold leading-tight">Your resume</h3>
                <p className="text-[13px] text-ink/55">Upload a PDF / text file, or paste it below.</p>
              </div>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "mb-3 flex items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3 transition",
                dragging ? "border-ink bg-lime/30" : "border-ink/15 bg-white/50 hover:border-ink/30",
              )}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-ink/5">{reading ? <Spinner /> : <Icon name="upload" className="size-5" />}</span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{reading ? "Reading your file…" : fileName ? fileName : "Drop a PDF, .txt or .md file"}</p>
                <p className="text-xs text-ink/50">PDFs and Word docs are read by AI · text files are read directly · max 2.5 MB PDF / 8 MB Word</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={reading}>
                Browse
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,text/plain,application/pdf"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </div>
            {fileError && <p className="mb-3 rounded-xl bg-coral/10 px-3 py-2 text-[13px] text-[#8f2a14]">{fileError}</p>}

            <textarea
              value={p.resume}
              onChange={(e) => {
                p.onResume(e.target.value);
                setFileName(null);
              }}
              placeholder="Paste your current resume as plain text — contact info, experience, skills, education…"
              aria-label="Resume text"
              className="min-h-[300px] w-full flex-1 resize-y rounded-2xl border border-ink/12 bg-white p-4 text-sm leading-relaxed outline-none transition focus:border-ink focus:ring-4 focus:ring-lime/50"
            />
            <p className={cn("mt-2 text-xs", resumeOk ? "text-mint" : "text-ink/45")}>
              {resumeOk ? "✓ Looks good" : `${p.resume.trim().length}/${MIN_RESUME}+ characters`}
            </p>
          </div>
        </div>

        {p.error && (
          <div className="mt-5">
            <ErrorBanner message={p.error} onDismiss={p.onDismissError} onRetry={canSubmit ? p.onSubmit : undefined} />
          </div>
        )}

        <div className="mt-6 flex flex-col items-stretch justify-between gap-4 rounded-3xl bg-ink p-5 text-paper sm:flex-row sm:items-center sm:p-6">
          <div className="flex items-start gap-3 text-sm text-paper/70">
            <Icon name="shield" className="mt-0.5 size-5 text-lime" />
            <p className="max-w-lg leading-relaxed">
              Your data stays in this browser. Text and video are sent to Google Gemini only to be analysed — never stored on our side.
            </p>
          </div>
          <Button variant="lime" size="lg" onClick={p.onSubmit} disabled={!canSubmit} loading={p.loading} className="shrink-0">
            {p.loading ? "Tailoring your resume…" : "Tailor my resume"}
            {!p.loading && <Icon name="sparkles" />}
          </Button>
        </div>
      </section>

      {/* ───────── How it works ───────── */}
      <section className="border-y border-ink/10 bg-paper-2/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">One agent. Resume to offer.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: "01", icon: "file", t: "Smart Tailor", d: "Rewrites bullets around the job's keywords — honestly, never inventing experience — and shows your ATS match before and after." },
              { n: "02", icon: "target", t: "Targeted questions", d: "Five questions built from your tailored resume and the job posting. No generic “tell me about yourself”." },
              { n: "03", icon: "video", t: "On-camera interview", d: "An AI interviewer speaks each question. You answer on video; recordings live only in your browser's memory." },
              { n: "04", icon: "sparkles", t: "Multi-modal scoring", d: "Gemini watches and listens: STAR content, pacing, filler words, eye contact, posture — scored on one scorecard." },
            ].map((s) => (
              <div key={s.n} className="rounded-3xl border border-ink/10 bg-white/70 p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-ink/5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-ink/40">{s.n}</span>
                  <span className="grid size-10 place-items-center rounded-xl bg-lime">
                    <Icon name={s.icon as "file" | "target" | "video" | "sparkles"} className="size-5" />
                  </span>
                </div>
                <h3 className="mt-5 font-display text-xl font-bold">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── History ───────── */}
      {p.sessions.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <Eyebrow>Saved on this device</Eyebrow>
              <h2 className="mt-1 font-display text-3xl font-bold tracking-tight">Your past runs</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={p.onClearSessions}>
              <Icon name="trash" /> Clear history
            </Button>
          </div>

          {trend.length > 1 && (
            <div className="mb-5 flex items-end gap-2 rounded-3xl border border-ink/10 bg-white/60 p-5" aria-label="Score trend">
              <p className="mr-3 self-start font-mono text-[11px] uppercase tracking-widest text-ink/50">Trend</p>
              {trend.map((s) => (
                <div key={s.id} className="flex flex-1 flex-col items-center gap-1" title={`${s.overall}/100 · ${formatDate(s.createdAt)}`}>
                  <span className="font-mono text-[11px] text-ink/60">{s.overall}</span>
                  <div className="w-full max-w-10 rounded-t-lg" style={{ height: Math.max(8, s.overall * 0.7), background: scoreColor(s.overall) }} />
                </div>
              ))}
            </div>
          )}

          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {p.sessions.map((s) => {
              const tier = tierFor(s.overall);
              return (
                <li key={s.id} className="flex min-w-0 items-center gap-4 rounded-3xl border border-ink/10 bg-white/70 p-4">
                  <div
                    className="grid size-16 shrink-0 place-items-center rounded-2xl font-display text-2xl font-extrabold text-white"
                    style={{ background: scoreColor(s.overall) }}
                  >
                    {s.overall}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {s.jobTitle || "Mock interview"}
                      {s.company ? <span className="font-normal text-ink/50"> · {s.company}</span> : null}
                    </p>
                    <p className="text-xs text-ink/50">
                      {tier.emoji} {tier.label} · {formatDate(s.createdAt)}
                      {s.demo ? " · sample" : ""}
                    </p>
                    <div className="mt-2 max-w-48">
                      <MeterBar value={s.overall} height={5} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    <Button variant="secondary" size="sm" onClick={() => p.onOpenSession(s)}>
                      Open
                    </Button>
                    <button onClick={() => p.onDeleteSession(s.id)} aria-label="Delete this run" className="grid size-8 place-items-center rounded-full text-ink/45 hover:bg-coral/10 hover:text-coral">
                      <Icon name="trash" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer className="border-t border-ink/10 py-10 text-center text-[13px] text-ink/50">
        <div className="mb-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <button onClick={p.onPrivacy} className="font-medium underline decoration-ink/20 underline-offset-4 hover:text-ink">
            Privacy
          </button>
          <a href="#start" className="font-medium underline decoration-ink/20 underline-offset-4 hover:text-ink">
            New interview
          </a>
          {p.canInstall && (
            <button onClick={p.onInstall} className="inline-flex items-center gap-1.5 font-medium underline decoration-ink/20 underline-offset-4 hover:text-ink">
              <Icon name="download" className="size-3.5" /> Install app
            </button>
          )}
        </div>
        <p>
          CareerAgent.ai — free &amp; private by design. Powered by Google Gemini. AI feedback is a coaching aid, not a hiring guarantee.
        </p>
      </footer>
    </div>
  );
}
