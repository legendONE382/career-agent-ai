import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerRecord, Question, SessionRecord, Stage, TailorResult } from "./types";
import {
  analyzeAnswer,
  detectBackend,
  errorMessage,
  generateQuestions,
  setDemoMode,
  summarizeSession,
  tailorResume,
  type BackendInfo,
} from "./lib/gemini";
import { stopStream } from "./lib/media";
import { aggregate } from "./lib/scoring";
import { speechSupported, stopSpeaking, warmUpVoices } from "./lib/speech";
import { clearSessions, deleteSession, loadDraft, loadSessions, saveDraft, saveSession } from "./lib/storage";
import { uid } from "./lib/utils";
import { useInstall } from "./lib/useInstall";
import { InstallBanner } from "./components/InstallBanner";
import { PrivacyDialog } from "./components/PrivacyDialog";
import { Header } from "./components/Header";
import { SetupView } from "./components/SetupView";
import { ReviewView } from "./components/ReviewView";
import { LobbyView } from "./components/LobbyView";
import { InterviewRoom } from "./components/InterviewRoom";
import { AnalyzingView } from "./components/AnalyzingView";
import { ResultsView } from "./components/ResultsView";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  const [draft] = useState(() => loadDraft());

  const [stage, setStage] = useState<Stage>("setup");
  const [job, setJob] = useState(draft.job);
  const [resume, setResume] = useState(draft.resume);
  const [tailor, setTailor] = useState<TailorResult | null>(null);
  const [resumeMd, setResumeMd] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [backend, setBackend] = useState<BackendInfo | null>(null);
  const [demo, setDemo] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [fresh, setFresh] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [installArmed, setInstallArmed] = useState(false);
  const install = useInstall();

  const finalizingRef = useRef(false);
  const questionsKey = useRef("");
  const sessionId = useRef(uid());
  // Bumped whenever a run is discarded, so late-arriving analyses can't leak into a new run.
  const runRef = useRef(0);
  const invalidateRuns = () => {
    runRef.current += 1;
  };

  /* ───────── boot ───────── */
  useEffect(() => {
    warmUpVoices();
    let alive = true;
    void detectBackend().then((b) => alive && setBackend(b));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => saveDraft({ job, resume }), 500);
    return () => clearTimeout(t);
  }, [job, resume]);

  /* Connectivity: keep the status honest and reconnect automatically. */
  useEffect(() => {
    const up = () => {
      setOnline(true);
      void detectBackend(true).then(setBackend);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  /* While the AI service is unreachable, quietly retry in the background. */
  useEffect(() => {
    if (backend && backend.kind !== "none") return;
    const retry = () => {
      if (navigator.onLine) void detectBackend(true).then(setBackend);
    };
    const id = setInterval(retry, 45_000);
    window.addEventListener("focus", retry);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", retry);
    };
  }, [backend]);

  /* Arm the install nudge after the visitor has settled in (never mid-interview). */
  useEffect(() => {
    if (stage !== "setup") setInstallArmed(true);
    const t = setTimeout(() => setInstallArmed(true), 15_000);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [stage]);

  // Release the camera whenever we leave the lobby / interview.
  useEffect(() => {
    if (stage !== "lobby" && stage !== "interview" && stream) {
      stopStream(stream);
      setStream(null);
    }
  }, [stage, stream]);

  useEffect(() => {
    if (stage === "interview" || stage === "analyzing") {
      const warn = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    }
  }, [stage]);

  useEffect(
    () => () => {
      stopSpeaking();
    },
    [],
  );

  /* ───────── backend / demo ───────── */
  const recheck = useCallback(() => {
    setBackend(null);
    void detectBackend(true).then(setBackend);
  }, []);

  function enableDemo() {
    setDemoMode(true);
    setDemo(true);
    setError(null);
  }

  function exitDemo() {
    setDemoMode(false);
    setDemo(false);
    resetFlow();
  }

  /* ───────── flow ───────── */
  function resetFlow() {
    stopSpeaking();
    invalidateRuns();
    setTailor(null);
    setResumeMd("");
    setQuestions([]);
    setAnswers([]);
    setRecord(null);
    setFresh(false);
    setError(null);
    setFinalizing(false);
    finalizingRef.current = false;
    questionsKey.current = "";
    setStage("setup");
  }

  async function handleTailor() {
    setError(null);
    setTailoring(true);
    try {
      const result = await tailorResume(job.trim(), resume.trim());
      setTailor(result);
      setResumeMd(result.resumeMarkdown);
      questionsKey.current = "";
      setStage("review");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTailoring(false);
    }
  }

  async function handleStartInterview() {
    if (!tailor) return;
    setError(null);
    const key = `${job}||${resumeMd}`;
    if (questions.length && questionsKey.current === key) {
      setStage("lobby");
      return;
    }
    setStarting(true);
    try {
      const qs = await generateQuestions(job.trim(), resumeMd, tailor.jobTitle);
      setQuestions(qs);
      questionsKey.current = key;
      setStage("lobby");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  function beginInterview() {
    if (!stream) return;
    invalidateRuns();
    sessionId.current = uid();
    setAnswers([]);
    finalizingRef.current = false;
    setFinalizing(false);
    setStage("interview");
  }

  const runAnalysis = useCallback(
    async (index: number, blob: Blob, mime: string, durationSec: number) => {
      const run = runRef.current;
      const patch = (p: Partial<AnswerRecord>) => {
        if (run !== runRef.current) return; // run was discarded (quit / retake / new interview)
        setAnswers((prev) => prev.map((a, i) => (i === index && a ? { ...a, ...p } : a)));
      };
      try {
        const analysis = await analyzeAnswer({
          question: questions[index],
          index,
          job,
          resume: resumeMd,
          jobTitle: tailor?.jobTitle ?? "",
          blob,
          mime,
          durationSec,
        });
        patch({ status: "done", analysis, error: undefined });
      } catch (e) {
        patch({ status: "error", error: errorMessage(e) });
      }
    },
    [questions, job, resumeMd, tailor],
  );

  function handleAnswer(index: number, data: { blob: Blob; mime: string; durationSec: number }) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = { questionId: questions[index].id, ...data, status: "analyzing" };
      return next;
    });
    void runAnalysis(index, data.blob, data.mime, data.durationSec);
  }

  function retryAnalysis(index: number) {
    const a = answers[index];
    if (!a) return;
    setAnswers((prev) => prev.map((x, i) => (i === index && x ? { ...x, status: "analyzing", error: undefined } : x)));
    void runAnalysis(index, a.blob, a.mime, a.durationSec);
  }

  const finalize = useCallback(async () => {
    if (finalizingRef.current || !tailor) return;
    finalizingRef.current = true;
    setFinalizing(true);
    const items = questions.map((_, i) => {
      const a = answers[i];
      return a && a.status === "done" && a.analysis ? { analysis: a.analysis, durationSec: a.durationSec } : null;
    });
    const summary = await summarizeSession(
      tailor.jobTitle,
      questions,
      items.map((x) => x?.analysis ?? null),
    );
    const agg = aggregate(items);
    const rec: SessionRecord = {
      id: sessionId.current,
      createdAt: Date.now(),
      jobTitle: tailor.jobTitle,
      company: tailor.company,
      overall: agg.overall,
      content: agg.content,
      delivery: agg.delivery,
      body: agg.body,
      fillerTotal: agg.fillerTotal,
      avgWpm: agg.avgWpm,
      atsBefore: tailor.atsBefore,
      atsAfter: tailor.atsAfter,
      summary,
      questions,
      answers: items,
      resumeMarkdown: resumeMd,
      demo,
    };
    setSessions(saveSession(rec));
    setRecord(rec);
    setFresh(true);
    setFinalizing(false);
    finalizingRef.current = false;
    setStage("results");
  }, [tailor, questions, answers, resumeMd, demo]);

  // When every answer has been analysed successfully, build the scorecard automatically.
  useEffect(() => {
    if (stage !== "analyzing" || finalizingRef.current || !questions.length) return;
    for (let i = 0; i < questions.length; i++) {
      const a = answers[i];
      if (!a || a.status !== "done") return;
    }
    void finalize();
  }, [stage, answers, questions, finalize]);

  function retake() {
    stopSpeaking();
    invalidateRuns();
    setAnswers([]);
    setRecord(null);
    setFresh(false);
    setFinalizing(false);
    finalizingRef.current = false;
    setStage("lobby");
  }

  function goHome() {
    if ((stage === "interview" || stage === "analyzing") && !window.confirm("Leave this interview? Your recordings will be lost.")) return;
    if (stage === "results") return resetFlow();
    if (stage === "interview" || stage === "analyzing") {
      invalidateRuns();
      setAnswers([]);
      finalizingRef.current = false;
      setFinalizing(false);
    }
    setStage("setup");
  }

  function openSession(s: SessionRecord) {
    setRecord(s);
    setFresh(false);
    setStage("results");
  }

  const videos = record && fresh ? record.questions.map((_, i) => answers[i]?.blob ?? null) : [];

  const installVisible =
    installArmed && !install.installed && !install.dismissed && (install.canInstall || install.isIOS) && ["setup", "review", "results"].includes(stage);

  function handleInstallClick() {
    if (install.canInstall) void install.promptInstall();
    else setInstallArmed(true); // iOS / fallback: reveal the banner with guided steps
  }

  function clearAllLocalData() {
    setSessions(clearSessions());
    saveDraft({ job: "", resume: "" });
    setJob("");
    setResume("");
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen">
        <Header
          stage={stage}
          backend={backend}
          demo={demo}
          online={online}
          canInstall={install.canInstall}
          onInstall={handleInstallClick}
          onHome={goHome}
          onExitDemo={exitDemo}
        />
        {!online && (
          <div className="border-b border-amber/30 bg-amber/15 px-4 py-2 text-center text-[13px] font-medium text-[#7a5200]">
            You're offline — saved scorecards still work. AI features resume when you reconnect.
          </div>
        )}
        <main>
          {stage === "setup" && (
            <SetupView
              job={job}
              resume={resume}
              onJob={setJob}
              onResume={setResume}
              onSubmit={() => void handleTailor()}
              loading={tailoring}
              error={error}
              onDismissError={() => setError(null)}
              backend={backend}
              demo={demo}
              onEnableDemo={enableDemo}
              onRecheck={recheck}
              sessions={sessions}
              onOpenSession={openSession}
              onDeleteSession={(id) => setSessions(deleteSession(id))}
              onClearSessions={() => {
                if (window.confirm("Delete all saved interview history on this device?")) setSessions(clearSessions());
              }}
              online={online}
              onPrivacy={() => setPrivacyOpen(true)}
              canInstall={install.canInstall || (install.isIOS && !install.installed)}
              onInstall={handleInstallClick}
            />
          )}

          {stage === "review" && tailor && (
            <ReviewView
              tailor={tailor}
              resumeMd={resumeMd}
              onResumeChange={setResumeMd}
              onStart={() => void handleStartInterview()}
              onBack={() => {
                setError(null);
                setStage("setup");
              }}
              starting={starting}
              error={error}
              onDismissError={() => setError(null)}
            />
          )}

          {stage === "lobby" && (
            <LobbyView
              stream={stream}
              onStream={setStream}
              questions={questions}
              voiceOn={voiceOn && speechSupported}
              onVoice={setVoiceOn}
              onStart={beginInterview}
              onBack={() => setStage("review")}
              demo={demo}
            />
          )}

          {stage === "interview" && stream && (
            <InterviewRoom
              questions={questions}
              stream={stream}
              voiceOn={voiceOn}
              onVoice={setVoiceOn}
              answers={answers}
              onAnswer={handleAnswer}
              onComplete={() => setStage("analyzing")}
              onQuit={() => {
                invalidateRuns();
                setAnswers([]);
                setStage("review");
              }}
            />
          )}

          {stage === "analyzing" && (
            <AnalyzingView
              questions={questions}
              answers={answers}
              finalizing={finalizing}
              onRetry={retryAnalysis}
              onContinue={() => void finalize()}
              onStartOver={retake}
            />
          )}

          {stage === "results" && record && (
            <ResultsView record={record} videos={videos} canRetake={fresh} onRetake={retake} onNew={resetFlow} />
          )}
        </main>
        <InstallBanner install={install} visible={installVisible} />
        <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} onClearData={clearAllLocalData} />
      </div>
    </ErrorBoundary>
  );
}
