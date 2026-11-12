import type { AnswerRecord, Question } from "../types";
import { scoreColor } from "../lib/scoring";
import { cn } from "../utils/cn";
import { Button, Eyebrow, Icon, MeterBar, Spinner } from "./ui";

interface Props {
  questions: Question[];
  answers: AnswerRecord[];
  finalizing: boolean;
  onRetry: (index: number) => void;
  onContinue: () => void;
  onStartOver: () => void;
}

export function AnalyzingView({ questions, answers, finalizing, onRetry, onContinue, onStartOver }: Props) {
  const total = questions.length;
  const done = answers.filter((a) => a?.status === "done").length;
  const failed = answers.filter((a) => a?.status === "error").length;
  const working = answers.filter((a) => a?.status === "analyzing").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in px-4 py-12 sm:px-6">
      <div className="text-center">
        <Eyebrow>Step 3 · Scoring</Eyebrow>
        <h2 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          {finalizing ? "Building your scorecard…" : working > 0 ? "Gemini is watching your tape…" : failed > 0 ? "Almost there" : "Wrapping up…"}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-ink/65">
          Each answer is analysed for content (STAR), vocal delivery (pacing, filler words) and body language (eye contact, posture) — all from one video.
        </p>
      </div>

      <div className="mt-8 rounded-3xl bg-ink p-6 text-paper">
        <div className="mb-3 flex items-center justify-between font-mono text-xs uppercase tracking-widest text-paper/60">
          <span>Progress</span>
          <span>
            {done}/{total} analysed
          </span>
        </div>
        <MeterBar value={pct} dark height={10} />
      </div>

      <ul className="mt-5 space-y-3">
        {questions.map((q, i) => {
          const a = answers[i];
          return (
            <li key={q.id} className="rounded-3xl border border-ink/10 bg-white/70 p-5">
              <div className="flex items-start gap-4">
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full font-mono text-sm",
                    !a && "bg-ink/10 text-ink/50",
                    a?.status === "analyzing" && "bg-amber/20 text-[#8a5a00]",
                    a?.status === "done" && "bg-mint text-white",
                    a?.status === "error" && "bg-coral text-white",
                  )}
                >
                  {a?.status === "analyzing" ? <Spinner className="size-4" /> : a?.status === "done" ? <Icon name="check" className="size-5" /> : a?.status === "error" ? <Icon name="alert" className="size-5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink/45">
                    Q{i + 1} · {q.category}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-snug">{q.question}</p>
                  {a?.status === "analyzing" && <p className="mt-1 text-sm text-ink/55">Analysing video &amp; audio…</p>}
                  {a?.status === "error" && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <p className="text-sm text-[#8f2a14]">{a.error || "Analysis failed."}</p>
                      <Button size="sm" variant="secondary" onClick={() => onRetry(i)}>
                        <Icon name="refresh" /> Retry
                      </Button>
                    </div>
                  )}
                  {!a && <p className="mt-1 text-sm text-ink/45">No recording for this question.</p>}
                </div>
                {a?.status === "done" && a.analysis && (
                  <span className="font-display text-3xl font-extrabold tabular-nums" style={{ color: scoreColor(a.analysis.overall) }}>
                    {a.analysis.overall}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {finalizing && (
        <p className="mt-8 flex items-center justify-center gap-3 text-sm text-ink/60">
          <Spinner /> Writing your personalised feedback…
        </p>
      )}

      {!finalizing && working === 0 && failed > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {done > 0 && (
            <Button size="lg" onClick={onContinue}>
              Continue with {done} analysed answer{done === 1 ? "" : "s"} <Icon name="arrowRight" />
            </Button>
          )}
          <Button variant="secondary" onClick={onStartOver}>
            Start over
          </Button>
        </div>
      )}
    </div>
  );
}
