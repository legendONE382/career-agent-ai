import { useEffect, useMemo, useState } from "react";
import type { SessionRecord } from "../types";
import { aggregate, computeBadges, linkedInPost, paceLabel, spokenFeedback, tierFor } from "../lib/scoring";
import { renderShareCard } from "../lib/shareCard";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
import { resumeName } from "../lib/markdown";
import { copyText, downloadBlob, downloadText, formatDate, slugify } from "../lib/utils";
import { cn } from "../utils/cn";
import { AnswerCard } from "./AnswerCard";
import { Button, Chip, Eyebrow, Icon, MeterBar, ScoreRing } from "./ui";

interface Props {
  record: SessionRecord;
  videos: (Blob | null)[];
  canRetake: boolean;
  onRetake: () => void;
  onNew: () => void;
}

export function ResultsView({ record, videos, canRetake, onRetake, onNew }: Props) {
  const [copied, setCopied] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const tier = tierFor(record.overall);
  const agg = useMemo(() => aggregate(record.answers), [record.answers]);
  const badges = useMemo(() => computeBadges(record), [record]);
  const totalMin = record.answers.reduce((s, a) => s + (a ? a.durationSec : 0), 0) / 60;
  const fillerRate = totalMin > 0 ? agg.fillerTotal / totalMin : 0;
  const pace = paceLabel(agg.avgWpm);
  const maxFiller = Math.max(1, ...agg.fillerBreakdown.map((f) => f.count));
  const weakest = useMemo(() => {
    let idx = -1;
    let min = 101;
    record.answers.forEach((a, i) => {
      if (a && a.analysis.overall < min) {
        min = a.analysis.overall;
        idx = i;
      }
    });
    return idx;
  }, [record.answers]);

  useEffect(
    () => () => {
      stopSpeaking();
    },
    [],
  );

  async function copyPost() {
    const ok = await copyText(linkedInPost(record, window.location.origin));
    setCopied(ok);
    setNotice(ok ? null : "Couldn't access the clipboard in this browser.");
    setTimeout(() => setCopied(false), 2200);
  }

  async function downloadCard() {
    setRendering(true);
    try {
      const blob = await renderShareCard(record);
      if (blob) downloadBlob(blob, `careeragent-scorecard-${record.overall}.png`);
      else setNotice("Couldn't render the share card in this browser.");
    } finally {
      setRendering(false);
    }
  }

  function toggleSpeak() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(spokenFeedback(record), { rate: 1.02, onEnd: () => setSpeaking(false) });
  }

  const subScores: { label: string; value: number; icon: "target" | "mic" | "eye"; note: string }[] = [
    {
      label: "Answer content",
      value: record.content,
      icon: "target",
      note: `STAR coverage ${Math.round(agg.starCoverage * 100)}%`,
    },
    {
      label: "Vocal delivery",
      value: record.delivery,
      icon: "mic",
      note: agg.avgWpm ? `${agg.avgWpm} wpm · ${pace.label.toLowerCase()}` : "Pacing n/a",
    },
    {
      label: "Body language",
      value: record.body,
      icon: "eye",
      note: `${record.answers.filter(Boolean).length} answers on camera`,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl animate-fade-in px-4 py-10 sm:px-6">
      {/* ───── Scoreboard ───── */}
      <section className="bg-grid-dark relative overflow-hidden rounded-[2.5rem] bg-ink p-6 text-paper shadow-2xl shadow-ink/25 sm:p-10">
        <div className="pointer-events-none absolute -left-20 -top-20 size-96 rounded-full bg-lime/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col items-center gap-8 md:flex-row md:items-center md:gap-12">
          <div className="flex flex-col items-center">
            <ScoreRing value={record.overall} size={230} stroke={20} dark>
              <div className="text-center">
                <p className="font-display text-7xl font-extrabold leading-none tabular-nums">{record.overall}</p>
                <p className="mt-1 font-mono text-sm text-paper/50">/ 100</p>
              </div>
            </ScoreRing>
          </div>

          <div className="flex-1 text-center md:text-left">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-lime">
              Interview scorecard · {formatDate(record.createdAt)}
              {record.demo ? " · sample" : ""}
            </p>
            <h1 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {tier.emoji} {tier.label}
            </h1>
            <p className="mt-1 text-paper/60">
              {record.jobTitle}
              {record.company ? ` · ${record.company}` : ""} · Grade <span className="font-semibold text-lime">{tier.grade}</span>
            </p>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-paper/85">{record.summary.summary}</p>

            <div className="mt-6 flex flex-wrap justify-center gap-2.5 md:justify-start">
              <Button variant="lime" onClick={() => void copyPost()}>
                <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied!" : "Copy LinkedIn post"}
              </Button>
              <Button variant="darkGhost" onClick={() => void downloadCard()} loading={rendering}>
                <Icon name="image" /> Share card
              </Button>
              {speechSupported && (
                <Button variant="darkGhost" onClick={toggleSpeak}>
                  <Icon name={speaking ? "stop" : "volume"} /> {speaking ? "Stop" : "Hear feedback"}
                </Button>
              )}
            </div>
            {notice && <p className="mt-3 text-sm text-amber">{notice}</p>}
            <p className="mt-3 text-xs text-paper/45">
              Paste the post into LinkedIn and attach the share card.{" "}
              <a className="underline underline-offset-2 hover:text-paper" href="https://www.linkedin.com/feed/?shareActive=true" target="_blank" rel="noreferrer">
                Open LinkedIn ↗
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ───── Sub scores ───── */}
      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {subScores.map((s) => (
          <div key={s.label} className="rounded-3xl border border-ink/10 bg-white/70 p-6">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink/65">
                <Icon name={s.icon} className="size-4" /> {s.label}
              </span>
              <span className="font-display text-4xl font-extrabold tabular-nums">{s.value}</span>
            </div>
            <div className="mt-4">
              <MeterBar value={s.value} height={10} />
            </div>
            <p className="mt-3 text-[13px] text-ink/55">{s.note}</p>
          </div>
        ))}
      </section>

      {/* ───── Badges ───── */}
      <section className="mt-6 rounded-3xl border border-ink/10 bg-white/70 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Badges</h2>
          <span className="font-mono text-xs text-ink/50">
            {badges.filter((b) => b.earned).length}/{badges.length} unlocked
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {badges.map((b) => (
            <div
              key={b.name}
              className={cn(
                "rounded-2xl border p-4 text-center transition",
                b.earned ? "border-lime-deep/40 bg-lime/35" : "border-ink/10 bg-ink/[0.03] opacity-55 grayscale",
              )}
            >
              <div className="text-3xl">{b.emoji}</div>
              <p className="mt-2 text-sm font-bold">{b.name}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink/60">{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Delivery & STAR ───── */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-3xl border border-ink/10 bg-white/70 p-6">
          <h2 className="font-display text-xl font-bold">Vocal delivery</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-ink/5 p-3">
              <p className="font-display text-2xl font-extrabold tabular-nums">{agg.avgWpm ?? "—"}</p>
              <p className="text-[11px] text-ink/55">words / min</p>
            </div>
            <div className="rounded-2xl bg-ink/5 p-3">
              <p className="font-display text-2xl font-extrabold tabular-nums">{agg.fillerTotal}</p>
              <p className="text-[11px] text-ink/55">filler words</p>
            </div>
            <div className="rounded-2xl bg-ink/5 p-3">
              <p className="font-display text-2xl font-extrabold tabular-nums">{fillerRate.toFixed(1)}</p>
              <p className="text-[11px] text-ink/55">fillers / min</p>
            </div>
          </div>
          <div className="mt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">Filler word breakdown</p>
            {agg.fillerBreakdown.length === 0 ? (
              <p className="rounded-2xl bg-mint/10 p-4 text-sm text-[#0e7a53]">🎉 No filler words detected. Very clean delivery.</p>
            ) : (
              <ul className="space-y-2.5">
                {agg.fillerBreakdown.map((f) => (
                  <li key={f.word} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 truncate font-mono text-[13px]">“{f.word}”</span>
                    <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/8">
                      <div className="h-full rounded-full bg-coral" style={{ width: `${(f.count / maxFiller) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right font-mono text-[13px]">{f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-4">
            <Chip tone={pace.tone === "good" ? "good" : pace.tone === "warn" ? "warn" : "neutral"}>
              <Icon name="clock" className="size-3" /> Pace: {pace.label}
            </Chip>
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-ink/10 bg-white/70 p-6">
          <h2 className="font-display text-xl font-bold">STAR method coverage</h2>
          <p className="mt-1 text-sm text-ink/55">Situation · Task · Action · Result — per answer.</p>
          <ul className="mt-4 space-y-3">
            {record.questions.map((q, i) => {
              const a = record.answers[i]?.analysis;
              return (
                <li key={q.id} className="flex items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs text-lime">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink/70">{q.question}</span>
                  {a ? (
                    <span className="flex gap-1">
                      {(
                        [
                          ["S", a.star.situation],
                          ["T", a.star.task],
                          ["A", a.star.action],
                          ["R", a.star.result],
                        ] as [string, boolean][]
                      ).map(([l, on]) => (
                        <span
                          key={l}
                          className={cn(
                            "grid size-7 place-items-center rounded-md font-mono text-xs font-semibold",
                            on ? "bg-lime text-ink" : "bg-ink/8 text-ink/30",
                          )}
                        >
                          {l}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-ink/40">n/a</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-5 rounded-2xl bg-ink/5 p-4 text-sm">
            <span className="font-semibold">Resume match:</span> {record.atsBefore}% → <span className="font-semibold text-mint">{record.atsAfter}%</span> after tailoring
          </div>
        </div>
      </section>

      {/* ───── Coach notes ───── */}
      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { title: "Top strengths", items: record.summary.topStrengths, tone: "border-mint/25 bg-mint/8", head: "text-[#0e7a53]", icon: "check" as const },
          { title: "Biggest opportunities", items: record.summary.topImprovements, tone: "border-coral/25 bg-coral/8", head: "text-[#a12f15]", icon: "target" as const },
          { title: "Your practice plan", items: record.summary.nextSteps, tone: "border-cobalt/20 bg-cobalt/6", head: "text-cobalt", icon: "sparkles" as const },
        ].map((c) => (
          <div key={c.title} className={cn("rounded-3xl border p-6", c.tone)}>
            <h2 className={cn("flex items-center gap-2 font-display text-lg font-bold", c.head)}>
              <Icon name={c.icon} /> {c.title}
            </h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink/80">
              {c.items.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink/40" />
                  <span>{s}</span>
                </li>
              ))}
              {c.items.length === 0 && <li className="text-ink/45">—</li>}
            </ul>
          </div>
        ))}
      </section>

      {/* ───── Per question ───── */}
      <section className="mt-10">
        <Eyebrow>Question by question</Eyebrow>
        <h2 className="mb-5 mt-1 font-display text-3xl font-bold tracking-tight">Transcripts, replays &amp; rewrites</h2>
        <div className="space-y-3">
          {record.questions.map((q, i) => (
            <AnswerCard key={q.id} index={i} question={q} answer={record.answers[i] ?? null} video={videos[i] ?? null} defaultOpen={i === weakest || (weakest < 0 && i === 0)} />
          ))}
        </div>
        {weakest >= 0 && <p className="mt-3 text-xs text-ink/50">We opened your lowest-scoring answer first — that's where the biggest gains are.</p>}
      </section>

      {/* ───── Footer actions ───── */}
      <section className="mt-10 flex flex-col items-stretch justify-between gap-4 rounded-3xl bg-ink p-6 text-paper sm:flex-row sm:items-center">
        <div>
          <p className="font-display text-2xl font-bold">Go again — beat {record.overall}.</p>
          <p className="mt-1 text-sm text-paper/60">Scores are saved on this device so you can track progress.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="darkGhost"
            onClick={() => downloadText(record.resumeMarkdown, `${slugify(resumeName(record.resumeMarkdown))}-tailored.md`, "text/markdown")}
          >
            <Icon name="download" /> Resume
          </Button>
          {canRetake && (
            <Button variant="darkGhost" onClick={onRetake}>
              <Icon name="refresh" /> Retake same questions
            </Button>
          )}
          <Button variant="lime" onClick={onNew}>
            New interview <Icon name="arrowRight" />
          </Button>
        </div>
      </section>
    </div>
  );
}
