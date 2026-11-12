import { useEffect, useMemo, useState } from "react";
import type { Question, SavedAnswer } from "../types";
import { paceLabel, scoreColor } from "../lib/scoring";
import { copyText, formatTime } from "../lib/utils";
import { cn } from "../utils/cn";
import { Button, Chip, Icon, MeterBar } from "./ui";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALWAYS = ["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm"];
const SKIP = new Set(["like", "so"]);

function Transcript({ text, fillers }: { text: string; fillers: string[] }) {
  const parts = useMemo(() => {
    const words = Array.from(new Set([...ALWAYS, ...fillers.filter((f) => !SKIP.has(f))])).filter(Boolean);
    const re = new RegExp(`\\b(${words.map(escapeRe).join("|")})\\b`, "gi");
    return text.split(re);
  }, [text, fillers]);
  return (
    <p className="text-[15px] leading-relaxed text-ink/80">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-coral/20 px-0.5 font-semibold text-[#a12f15]">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function StarChips({ star }: { star: SavedAnswer["analysis"]["star"] }) {
  const items: [string, boolean, string][] = [
    ["S", star.situation, "Situation"],
    ["T", star.task, "Task"],
    ["A", star.action, "Action"],
    ["R", star.result, "Result"],
  ];
  return (
    <div className="flex gap-1.5" aria-label="STAR coverage">
      {items.map(([letter, on, label]) => (
        <span
          key={letter}
          title={`${label}: ${on ? "covered" : "missing"}`}
          className={cn(
            "grid size-8 place-items-center rounded-lg font-mono text-sm font-semibold",
            on ? "bg-lime text-ink" : "bg-ink/8 text-ink/35 line-through",
          )}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}

interface Props {
  index: number;
  question: Question;
  answer: SavedAnswer | null;
  video?: Blob | null;
  defaultOpen?: boolean;
}

export function AnswerCard({ index, question, answer, video, defaultOpen }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [copied, setCopied] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!video || !open) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video, open]);

  const a = answer?.analysis;

  async function copyRewrite() {
    if (!a?.suggestedRewrite) return;
    const ok = await copyText(a.suggestedRewrite);
    setCopied(ok);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white/75">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-white"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink font-mono text-sm text-lime">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <Chip className="mb-1.5">{question.category}</Chip>
          <p className="line-clamp-2 text-[15px] font-medium leading-snug">{question.question}</p>
        </div>
        {a ? (
          <span className="font-display text-3xl font-extrabold tabular-nums" style={{ color: scoreColor(a.overall) }}>
            {a.overall}
          </span>
        ) : (
          <Chip tone="warn">Not analysed</Chip>
        )}
        <Icon name="chevronDown" className={cn("size-5 text-ink/40 transition-transform", open && "rotate-180")} />
      </button>

      {open && a && answer && (
        <div className="grid gap-8 border-t border-ink/10 p-5 sm:p-7 lg:grid-cols-[320px_1fr]">
          {/* Left: stats */}
          <div className="space-y-5">
            {videoUrl && (
              <video src={videoUrl} controls playsInline preload="metadata" className="aspect-[4/3] w-full rounded-2xl bg-black object-cover" />
            )}
            {video && !videoUrl && <div className="skeleton aspect-[4/3] w-full rounded-2xl" />}
            {!video && (
              <p className="rounded-2xl bg-ink/5 px-4 py-3 text-xs text-ink/55">
                🔒 Video isn't saved — recordings are discarded when you leave this page.
              </p>
            )}

            <div className="space-y-3">
              {(
                [
                  ["Content", a.contentScore],
                  ["Delivery", a.deliveryScore],
                  ["Body language", a.bodyScore],
                ] as [string, number][]
              ).map(([label, v]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-ink/65">{label}</span>
                    <span className="font-mono font-medium">{v}</span>
                  </div>
                  <MeterBar value={v} height={6} />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl bg-ink/5 p-3">
                <p className="text-xs text-ink/50">Length</p>
                <p className="font-mono font-medium">{formatTime(answer.durationSec)}</p>
              </div>
              <div className="rounded-2xl bg-ink/5 p-3">
                <p className="text-xs text-ink/50">Pace</p>
                <p className="font-mono font-medium">{a.wpm ? `${a.wpm} wpm` : "—"}</p>
                <p className="text-[11px] text-ink/50">{paceLabel(a.wpm).label}</p>
              </div>
              <div className="rounded-2xl bg-ink/5 p-3">
                <p className="text-xs text-ink/50">Filler words</p>
                <p className="font-mono font-medium">{a.fillerTotal}</p>
              </div>
              <div className="rounded-2xl bg-ink/5 p-3">
                <p className="text-xs text-ink/50">Eye contact</p>
                <p className="font-medium capitalize">{a.eyeContact}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink/50">STAR coverage</p>
              <StarChips star={a.star} />
            </div>
          </div>

          {/* Right: details */}
          <div className="space-y-6">
            <div>
              <h4 className="mb-2 font-display text-lg font-bold">What you said</h4>
              {a.transcript ? (
                <>
                  <div className="rounded-2xl bg-paper p-5">
                    <Transcript text={a.transcript} fillers={a.fillerWords.map((f) => f.word)} />
                  </div>
                  {a.fillerWords.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.fillerWords.map((f) => (
                        <Chip key={f.word} tone="bad">
                          “{f.word}” ×{f.count}
                        </Chip>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="rounded-2xl bg-coral/10 p-4 text-sm text-[#8f2a14]">No intelligible speech was detected in this recording.</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-mint/25 bg-mint/8 p-5">
                <h4 className="mb-2 flex items-center gap-2 font-display font-bold text-[#0e7a53]">
                  <Icon name="check" /> What worked
                </h4>
                <ul className="space-y-2 text-sm leading-relaxed text-ink/80">
                  {a.strengths.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                  {a.strengths.length === 0 && <li className="text-ink/50">—</li>}
                </ul>
              </div>
              <div className="rounded-2xl border border-coral/25 bg-coral/8 p-5">
                <h4 className="mb-2 flex items-center gap-2 font-display font-bold text-[#a12f15]">
                  <Icon name="target" /> Fix next
                </h4>
                <ul className="space-y-2 text-sm leading-relaxed text-ink/80">
                  {a.improvements.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                  {a.improvements.length === 0 && <li className="text-ink/50">—</li>}
                </ul>
              </div>
            </div>

            {a.bodyNotes.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
                  <Icon name="eye" /> Body language
                </h4>
                <ul className="space-y-1.5 text-sm leading-relaxed text-ink/75">
                  {a.bodyNotes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              </div>
            )}

            {a.suggestedRewrite && (
              <div className="rounded-2xl bg-ink p-5 text-paper">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="flex items-center gap-2 font-display font-bold text-lime">
                    <Icon name="sparkles" /> A stronger version
                  </h4>
                  <Button size="sm" variant="darkGhost" onClick={() => void copyRewrite()}>
                    <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-[15px] leading-relaxed text-paper/85">“{a.suggestedRewrite}”</p>
              </div>
            )}

            {question.keyPoints.length > 0 && (
              <details className="rounded-2xl border border-ink/10 p-4 text-sm">
                <summary className="cursor-pointer font-semibold">What the interviewer was testing</summary>
                <p className="mt-2 text-ink/70">{question.intent}</p>
                <ul className="mt-2 space-y-1 text-ink/70">
                  {question.keyPoints.map((k, i) => (
                    <li key={i}>• {k}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
