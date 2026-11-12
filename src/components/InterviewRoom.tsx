import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerRecord, Question } from "../types";
import { MAX_ANSWER_SECONDS, MIN_ANSWER_SECONDS, startRecording, type ActiveRecording } from "../lib/media";
import { speak, speechSupported, stopSpeaking } from "../lib/speech";
import { useMicLevel } from "../lib/useMicLevel";
import { formatTime } from "../lib/utils";
import { cn } from "../utils/cn";
import { Button, Chip, ErrorBanner, Icon, Spinner } from "./ui";

type Phase = "asking" | "ready" | "recording" | "saving";

interface Props {
  questions: Question[];
  stream: MediaStream;
  voiceOn: boolean;
  onVoice: (v: boolean) => void;
  answers: AnswerRecord[];
  onAnswer: (index: number, data: { blob: Blob; mime: string; durationSec: number }) => void;
  onComplete: () => void;
  onQuit: () => void;
}

const TIPS = [
  "Open with one sentence of context, then get to what YOU did.",
  "Use numbers: time saved, revenue, users, error rates. Specifics beat adjectives.",
  "Finish with the result — and what you learned or would do differently.",
  "Pause silently instead of saying “um”. Silence sounds confident.",
  "Look at the camera lens, not your own face.",
];

export function InterviewRoom({ questions, stream, voiceOn, onVoice, answers, onAnswer, onComplete, onQuit }: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("asking");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<ActiveRecording | null>(null);
  const startRef = useRef(0);
  const cancelSpeechRef = useRef<() => void>(() => {});
  const voiceRef = useRef(voiceOn);
  const savingRef = useRef(false);
  const indexRef = useRef(0);
  const finishRef = useRef<() => void>(() => {});

  voiceRef.current = voiceOn;
  indexRef.current = index;

  const question = questions[index];
  const recording = phase === "recording";
  const level = useMicLevel(stream, recording || phase === "ready");

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.srcObject = stream;
  }, [stream]);

  /* Ask the question (speak it aloud) whenever the question changes. */
  useEffect(() => {
    setPhase("asking");
    setElapsed(0);
    const q = questions[index];
    if (!q) return;
    if (!voiceRef.current || !speechSupported) {
      const t = setTimeout(() => setPhase("ready"), 800);
      return () => clearTimeout(t);
    }
    const cancel = speak(q.question, { onEnd: () => setPhase("ready") });
    cancelSpeechRef.current = cancel;
    return cancel;
  }, [index, questions]);

  /* Recording clock + auto-stop. */
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const secs = (performance.now() - startRef.current) / 1000;
      setElapsed(secs);
      if (secs >= MAX_ANSWER_SECONDS) finishRef.current();
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

  /* Clean up on leaving the room. */
  useEffect(
    () => () => {
      stopSpeaking();
      recRef.current?.cancel();
      recRef.current = null;
    },
    [],
  );

  const replay = useCallback(() => {
    if (!question) return;
    cancelSpeechRef.current();
    setPhase("asking");
    cancelSpeechRef.current = speak(question.question, { onEnd: () => setPhase("ready") });
  }, [question]);

  function skipVoice() {
    cancelSpeechRef.current();
    stopSpeaking();
    setPhase("ready");
  }

  function startAnswer() {
    cancelSpeechRef.current();
    stopSpeaking();
    setError(null);
    try {
      recRef.current = startRecording(stream);
      startRef.current = performance.now();
      setElapsed(0);
      setPhase("recording");
    } catch {
      setError("Couldn't start recording. Check that your camera and microphone are still connected, then try again.");
    }
  }

  function restartAnswer() {
    recRef.current?.cancel();
    recRef.current = null;
    setPhase("ready");
    setElapsed(0);
    // Small delay lets the recorder fully release before starting a new one.
    setTimeout(startAnswer, 150);
  }

  async function finishAnswer() {
    if (savingRef.current || !recRef.current) return;
    savingRef.current = true;
    setPhase("saving");
    const rec = recRef.current;
    recRef.current = null;
    const i = indexRef.current;
    try {
      const result = await rec.stop();
      onAnswer(i, result);
      if (i >= questions.length - 1) onComplete();
      else setIndex(i + 1);
    } catch {
      setError("Something went wrong saving that answer. Please record it again.");
      setPhase("ready");
    } finally {
      savingRef.current = false;
    }
  }
  finishRef.current = () => void finishAnswer();

  if (!question) return null;

  const pct = Math.min(100, (elapsed / MAX_ANSWER_SECONDS) * 100);
  const canFinish = elapsed >= MIN_ANSWER_SECONDS;
  const statusText =
    phase === "asking" ? "Speaking…" : phase === "ready" ? "Your turn" : phase === "recording" ? "Listening…" : "Saving your answer…";

  return (
    <div className="bg-grid-dark relative min-h-[calc(100vh-4rem)] bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* Top bar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-lime">
              Question {index + 1} <span className="text-paper/40">/ {questions.length}</span>
            </p>
            <div className="flex items-center gap-1.5" aria-label="Question progress">
              {questions.map((_, i) => {
                const a = answers[i];
                return (
                  <span
                    key={i}
                    title={a ? `Answer ${i + 1}: ${a.status === "done" ? "analyzed" : a.status === "error" ? "needs retry" : "analyzing…"}` : undefined}
                    className={cn(
                      "h-2 rounded-full transition-all",
                      i === index ? "w-8 bg-lime" : "w-2",
                      i !== index && !a && "bg-white/20",
                      a?.status === "done" && i !== index && "bg-mint",
                      a?.status === "analyzing" && i !== index && "animate-pulse bg-amber",
                      a?.status === "error" && i !== index && "bg-coral",
                    )}
                  />
                );
              })}
            </div>
          </div>
          {confirmQuit ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-paper/70">Leave and lose this session?</span>
              <Button size="sm" variant="danger" onClick={onQuit}>
                Leave
              </Button>
              <Button size="sm" variant="darkGhost" onClick={() => setConfirmQuit(false)}>
                Stay
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="darkGhost" onClick={() => setConfirmQuit(true)} disabled={phase === "saving"}>
              <Icon name="x" /> Leave
            </Button>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* ───── Video ───── */}
          <div className="relative self-start overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl shadow-black/50">
            <div className="relative aspect-[4/3] w-full">
              <video ref={videoRef} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />

              <div className="absolute left-4 top-4 flex items-center gap-2">
                {recording ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-coral px-3 py-1.5 font-mono text-xs font-medium text-white shadow-lg">
                    <span className="size-2 animate-pulse rounded-full bg-white" /> REC {formatTime(elapsed)}
                    <span className="text-white/70">/ {formatTime(MAX_ANSWER_SECONDS)}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium backdrop-blur">
                    <span className="size-2 rounded-full bg-paper/50" /> Standby
                  </span>
                )}
              </div>

              <div className="absolute inset-x-4 bottom-5 flex items-center gap-3 rounded-2xl bg-black/55 px-4 py-2.5 backdrop-blur">
                <Icon name="mic" className={cn("size-4", recording ? "text-lime" : "text-paper/50")} />
                <div className="flex h-5 flex-1 items-center gap-[3px]" aria-label="Microphone level">
                  {Array.from({ length: 28 }).map((_, i) => {
                    const on = level * 28 > i;
                    return <span key={i} className={cn("w-full rounded-full transition-all duration-75", on ? "h-5 bg-lime" : "h-1.5 bg-white/20")} />;
                  })}
                </div>
              </div>

              {/* time bar */}
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/10">
                <div className={cn("h-full transition-[width] duration-200", pct > 85 ? "bg-coral" : "bg-lime")} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {/* ───── Interviewer ───── */}
          <div className="flex flex-col gap-4">
            <div className="rounded-[2rem] border border-white/10 bg-ink-2/90 p-6 backdrop-blur">
              <div className="flex items-center gap-4">
                <div className="relative grid size-16 shrink-0 place-items-center">
                  {phase === "asking" && (
                    <>
                      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-lime/40" />
                      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-lime/30 [animation-delay:0.9s]" />
                    </>
                  )}
                  <span
                    className={cn(
                      "relative grid size-16 place-items-center rounded-full bg-gradient-to-br from-lime to-lime-deep text-ink shadow-lg shadow-lime/20 transition-transform",
                      phase === "asking" && "scale-105",
                    )}
                  >
                    <Icon name={phase === "asking" ? "volume" : phase === "recording" ? "mic" : "sparkles"} className="size-7" />
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold leading-tight">Ava · AI Interviewer</p>
                  <p className="mt-0.5 flex items-center gap-2 text-sm text-paper/60">
                    {phase === "saving" && <Spinner className="size-3" />}
                    {statusText}
                  </p>
                </div>
                <div className="ml-auto">
                  <button
                    onClick={() => {
                      if (voiceOn) {
                        cancelSpeechRef.current();
                        stopSpeaking();
                        if (phase === "asking") setPhase("ready");
                      }
                      onVoice(!voiceOn);
                    }}
                    disabled={!speechSupported}
                    aria-label={voiceOn ? "Mute interviewer voice" : "Unmute interviewer voice"}
                    className="grid size-9 place-items-center rounded-full border border-white/15 text-paper/70 hover:bg-white/10 disabled:opacity-40"
                  >
                    <Icon name="volume" className={cn("size-4", !voiceOn && "opacity-40")} />
                  </button>
                </div>
              </div>

              <div className="mt-6">
                <Chip tone="dark">{question.category}</Chip>
                <p className="mt-3 font-display text-[1.65rem] font-bold leading-snug tracking-tight sm:text-[1.8rem]" aria-live="polite">
                  {question.question}
                </p>
              </div>
            </div>

            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

            {/* Controls */}
            <div className="rounded-[2rem] border border-white/10 bg-ink-2/60 p-5">
              {phase === "asking" && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="lime" size="lg" disabled className="flex-1">
                    <Icon name="mic" /> Start answering
                  </Button>
                  <Button variant="darkGhost" onClick={skipVoice}>
                    Skip voice
                  </Button>
                </div>
              )}
              {phase === "ready" && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="lime" size="lg" onClick={startAnswer} className="flex-1">
                    <Icon name="mic" /> Start answering
                  </Button>
                  {speechSupported && voiceOn && (
                    <Button variant="darkGhost" onClick={replay}>
                      <Icon name="refresh" /> Replay
                    </Button>
                  )}
                </div>
              )}
              {phase === "recording" && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="danger" size="lg" onClick={() => void finishAnswer()} disabled={!canFinish} className="flex-1">
                    <Icon name="stop" />
                    {canFinish ? (index === questions.length - 1 ? "Finish interview" : "Finish answer") : "Keep going…"}
                  </Button>
                  <Button variant="darkGhost" onClick={restartAnswer}>
                    <Icon name="refresh" /> Redo
                  </Button>
                </div>
              )}
              {phase === "saving" && (
                <p className="flex items-center justify-center gap-3 py-3 text-sm text-paper/70">
                  <Spinner /> Saving your answer…
                </p>
              )}
              <p className="mt-4 flex gap-2 text-[13px] leading-relaxed text-paper/55">
                <Icon name="sparkles" className="mt-0.5 size-3.5 text-lime" />
                <span>{TIPS[index % TIPS.length]}</span>
              </p>
            </div>
            <p className="px-2 text-xs text-paper/40">Each answer is analysed in the background while you continue.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
