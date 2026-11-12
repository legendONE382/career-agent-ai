import { useEffect, useRef, useState } from "react";
import type { Question } from "../types";
import { MAX_ANSWER_SECONDS, mediaSupported, openCamera, stopStream } from "../lib/media";
import { speechSupported } from "../lib/speech";
import { useMicLevel } from "../lib/useMicLevel";
import { cn } from "../utils/cn";
import { Button, Chip, ErrorBanner, Eyebrow, Icon } from "./ui";

interface Props {
  stream: MediaStream | null;
  onStream: (s: MediaStream | null) => void;
  questions: Question[];
  voiceOn: boolean;
  onVoice: (v: boolean) => void;
  onStart: () => void;
  onBack: () => void;
  demo: boolean;
}

export function LobbyView({ stream, onStream, questions, voiceOn, onVoice, onStart, onBack, demo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const level = useMicLevel(stream, true);
  const [heardVoice, setHeardVoice] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (level > 0.12) setHeardVoice(true);
  }, [level]);

  async function enable() {
    setRequesting(true);
    setError(null);
    try {
      stopStream(stream);
      const s = await openCamera();
      onStream(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the camera.");
    } finally {
      setRequesting(false);
    }
  }

  const ready = !!stream;

  return (
    <div className="mx-auto max-w-6xl animate-fade-in px-4 py-10 sm:px-6">
      <button onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-ink/60 hover:text-ink">
        <Icon name="arrowLeft" /> Back to resume
      </button>

      <div className="mb-8 flex flex-col gap-1">
        <Eyebrow>Step 2 · Green room</Eyebrow>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Check your camera &amp; mic</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* Camera preview */}
        <div className="overflow-hidden rounded-[2rem] bg-ink shadow-2xl shadow-ink/20">
          <div className="bg-grid-dark relative aspect-[4/3] w-full">
            <video ref={videoRef} autoPlay muted playsInline className={cn("size-full -scale-x-100 object-cover", !ready && "hidden")} />
            {!ready && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center text-paper">
                <div>
                  <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10">
                    <Icon name="video" className="size-8 text-lime" />
                  </span>
                  <p className="mt-5 font-display text-2xl font-bold">Camera is off</p>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-paper/60">
                    We'll ask your browser for permission. Video stays on your device until you finish each answer.
                  </p>
                  <Button variant="lime" className="mt-6" onClick={() => void enable()} loading={requesting} disabled={!mediaSupported}>
                    <Icon name="video" /> Enable camera &amp; mic
                  </Button>
                </div>
              </div>
            )}
            {ready && (
              <>
                <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-paper backdrop-blur">
                  <span className="size-2 rounded-full bg-mint" /> Preview
                </span>
                <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-black/55 px-4 py-3 backdrop-blur">
                  <Icon name="mic" className="size-5 text-lime" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15" aria-label="Microphone level">
                    <div className="h-full rounded-full bg-lime transition-[width] duration-75" style={{ width: `${Math.min(100, level * 100)}%` }} />
                  </div>
                  <span className="w-28 text-right text-xs text-paper/70">{heardVoice ? "Mic works ✓" : "Say something…"}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Briefing */}
        <div className="space-y-5">
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          {!mediaSupported && (
            <ErrorBanner message="This browser can't record video. Please use the latest Chrome, Edge, Firefox or Safari over HTTPS." />
          )}

          <div className="rounded-3xl border border-ink/10 bg-white/70 p-6">
            <h3 className="font-display text-xl font-bold">Your interview</h3>
            <ul className="mt-4 space-y-3 text-sm text-ink/75">
              <li className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-lime font-mono text-xs">{questions.length}</span>
                <span>
                  tailored questions — {Array.from(new Set(questions.map((q) => q.category))).join(", ")}
                </span>
              </li>
              <li className="flex gap-3">
                <Icon name="clock" className="mt-0.5 size-5 text-ink/40" />
                <span>Up to {MAX_ANSWER_SECONDS} seconds per answer. Aim for 60–90 using Situation → Task → Action → Result.</span>
              </li>
              <li className="flex gap-3">
                <Icon name="eye" className="mt-0.5 size-5 text-ink/40" />
                <span>Look at the camera lens, sit tall, and speak like you're in the room.</span>
              </li>
              <li className="flex gap-3">
                <Icon name="lock" className="mt-0.5 size-5 text-ink/40" />
                <span>
                  {demo
                    ? "Sample mode: nothing is uploaded anywhere."
                    : "Each answer is sent securely to Google Gemini for analysis, then discarded. Nothing is stored on our servers."}
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-3xl border border-ink/10 bg-white/70 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-ink/5">
                <Icon name="volume" className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">Interviewer voice</p>
                <p className="text-xs text-ink/55">
                  {speechSupported ? "Questions are read aloud by your browser." : "Not supported here — questions show as text."}
                </p>
              </div>
            </div>
            <button
              role="switch"
              aria-checked={voiceOn && speechSupported}
              disabled={!speechSupported}
              onClick={() => onVoice(!voiceOn)}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40",
                voiceOn && speechSupported ? "bg-ink" : "bg-ink/20",
              )}
            >
              <span className={cn("absolute top-1 size-5 rounded-full bg-lime transition-all", voiceOn && speechSupported ? "left-6" : "left-1 !bg-white")} />
              <span className="sr-only">Toggle interviewer voice</span>
            </button>
          </div>

          <Button variant="primary" size="lg" className="w-full" disabled={!ready} onClick={onStart}>
            {ready ? "I'm ready — start the interview" : "Enable your camera to begin"}
            {ready && <Icon name="arrowRight" />}
          </Button>
          {ready && (
            <div className="flex justify-center">
              <Chip tone="good">
                <Icon name="check" className="size-3" /> Camera &amp; mic ready
              </Chip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
