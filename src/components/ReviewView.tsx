import { useMemo, useState } from "react";
import type { TailorResult } from "../types";
import { markdownToHtml, resumeName, resumeToHtmlDocument } from "../lib/markdown";
import { copyText, downloadText, slugify } from "../lib/utils";
import { Button, Chip, ErrorBanner, Eyebrow, Icon, MeterBar } from "./ui";

interface Props {
  tailor: TailorResult;
  resumeMd: string;
  onResumeChange: (v: string) => void;
  onStart: () => void;
  onBack: () => void;
  starting: boolean;
  error: string | null;
  onDismissError: () => void;
}

export function ReviewView({ tailor, resumeMd, onResumeChange, onStart, onBack, starting, error, onDismissError }: Props) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const html = useMemo(() => markdownToHtml(resumeMd), [resumeMd]);
  const base = `${slugify(resumeName(resumeMd))}-tailored`;
  const gain = tailor.atsAfter - tailor.atsBefore;

  async function handleCopy() {
    const ok = await copyText(resumeMd);
    setCopied(ok);
    setNotice(ok ? null : "Couldn't access the clipboard — select the text in edit mode and copy it manually.");
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrint() {
    const doc = resumeToHtmlDocument(resumeMd, `${resumeName(resumeMd)} — Resume`);
    const w = window.open("", "_blank");
    if (!w) {
      setNotice("Your browser blocked the print window. Download the HTML file and print it from there.");
      return;
    }
    w.document.open();
    w.document.write(doc);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 450);
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-in px-4 py-10 sm:px-6">
      <button onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-ink/60 hover:text-ink">
        <Icon name="arrowLeft" /> Edit inputs
      </button>

      <div className="mb-8 flex flex-col gap-1">
        <Eyebrow>Step 1 · Tailored for {tailor.company || "your target role"}</Eyebrow>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Your resume, rebuilt for <span className="bg-lime px-2">{tailor.jobTitle}</span>
        </h2>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        {/* ───── Sidebar ───── */}
        <aside className="space-y-5 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-ink p-6 text-paper">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-lime">ATS match</p>
            <div className="mt-4 flex items-end gap-3">
              <div>
                <p className="text-xs text-paper/50">Before</p>
                <p className="font-display text-4xl font-extrabold text-paper/50 line-through decoration-coral decoration-2">{tailor.atsBefore}%</p>
              </div>
              <Icon name="arrowRight" className="mb-3 size-6 text-lime" />
              <div>
                <p className="text-xs text-paper/50">After</p>
                <p className="font-display text-5xl font-extrabold text-lime">{tailor.atsAfter}%</p>
              </div>
              {gain > 0 && <span className="mb-2 ml-auto rounded-full bg-lime px-2.5 py-1 font-mono text-xs font-medium text-ink">+{gain} pts</span>}
            </div>
            <div className="mt-5 space-y-2">
              <MeterBar value={tailor.atsBefore} dark height={6} />
              <MeterBar value={tailor.atsAfter} dark height={6} />
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-paper/55">Estimated keyword & requirements overlap with the posting.</p>
          </div>

          {tailor.changes.length > 0 && (
            <div className="rounded-3xl border border-ink/10 bg-white/70 p-6">
              <h3 className="font-display text-lg font-bold">What changed</h3>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink/75">
                {tailor.changes.map((c, i) => (
                  <li key={i} className="flex gap-2.5">
                    <Icon name="check" className="mt-1 size-3.5 text-mint" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(tailor.matchedKeywords.length > 0 || tailor.addedKeywords.length > 0 || tailor.missingSkills.length > 0) && (
            <div className="space-y-4 rounded-3xl border border-ink/10 bg-white/70 p-6">
              {tailor.addedKeywords.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink/50">Keywords surfaced</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tailor.addedKeywords.map((k) => (
                      <span key={k} className="rounded-full bg-lime px-2.5 py-1 text-xs font-semibold">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {tailor.matchedKeywords.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink/50">Already matching</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tailor.matchedKeywords.map((k) => (
                      <Chip key={k} tone="good">
                        {k}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {tailor.missingSkills.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink/50">Gaps to be ready for</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tailor.missingSkills.map((k) => (
                      <Chip key={k} tone="warn">
                        {k}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink/50">We never add skills you don't have — expect questions about these.</p>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ───── Resume paper ───── */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)}>
              <Icon name={editing ? "eye" : "pencil"} /> {editing ? "Preview" : "Edit"}
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
                <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => downloadText(resumeMd, `${base}.md`, "text/markdown")}>
                <Icon name="download" /> .md
              </Button>
              <Button variant="secondary" size="sm" onClick={() => downloadText(resumeToHtmlDocument(resumeMd, `${resumeName(resumeMd)} — Resume`), `${base}.html`, "text/html")}>
                <Icon name="download" /> .html
              </Button>
              <Button variant="secondary" size="sm" onClick={handlePrint}>
                <Icon name="file" /> Print / PDF
              </Button>
            </div>
          </div>
          {notice && <p className="mb-3 rounded-xl bg-amber/15 px-3 py-2 text-[13px] text-[#7a5200]">{notice}</p>}

          {editing ? (
            <textarea
              value={resumeMd}
              onChange={(e) => onResumeChange(e.target.value)}
              spellCheck={false}
              aria-label="Edit tailored resume (Markdown)"
              className="min-h-[640px] w-full resize-y rounded-3xl border border-ink/15 bg-white p-6 font-mono text-[13px] leading-relaxed outline-none focus:border-ink focus:ring-4 focus:ring-lime/50"
            />
          ) : (
            <article
              className="resume-doc min-h-[640px] rounded-3xl border border-ink/10 bg-white p-8 shadow-xl shadow-ink/5 sm:p-12"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          <p className="mt-3 text-xs text-ink/50">
            Tip: review every line — it's your resume. Edit anything, then download. Your edits also feed the interview questions.
          </p>
        </div>
      </div>

      {/* ───── CTA ───── */}
      <div className="mt-10 space-y-4">
        {error && <ErrorBanner message={error} onDismiss={onDismissError} onRetry={onStart} />}
        <div className="flex flex-col items-stretch justify-between gap-4 rounded-3xl bg-ink p-6 text-paper sm:flex-row sm:items-center">
          <div>
            <p className="font-display text-2xl font-bold">Ready to be grilled?</p>
            <p className="mt-1 text-sm text-paper/60">5 questions written from this resume and the job. Camera + mic required. About 10 minutes.</p>
          </div>
          <Button variant="lime" size="lg" onClick={onStart} loading={starting} className="shrink-0">
            {starting ? "Writing your questions…" : "Start mock interview"}
            {!starting && <Icon name="arrowRight" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
