import { useEffect, useState } from "react";
import { Button, Icon } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  onClearData: () => void;
}

const SECTIONS: { icon: "lock" | "shield" | "eye" | "trash"; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "No account. No tracking.",
    body: "CareerAgent works without sign-up. We run no ads, no analytics scripts and no tracking cookies.",
  },
  {
    icon: "shield",
    title: "Your device keeps your history.",
    body: "Resumes, drafts and scorecards are stored only in this browser (local storage). Recordings live in memory and disappear when you leave the page — they are never saved by us.",
  },
  {
    icon: "eye",
    title: "What the AI sees.",
    body: "To score you, your job text, resume and each recorded answer are sent securely to Google Gemini for analysis and then discarded by our servers. On Google's free tier, submitted content may be used to improve their products — avoid sharing sensitive personal details.",
  },
  {
    icon: "trash",
    title: "You stay in control.",
    body: "Clear everything stored on this device at any time with one click below. Uninstalling the app also removes local data.",
  },
];

export function PrivacyDialog({ open, onClose, onClearData }: Props) {
  const [cleared, setCleared] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) {
      setCleared(false);
      setConfirming(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Privacy at CareerAgent"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg animate-fade-up overflow-y-auto rounded-3xl bg-paper p-6 text-ink shadow-2xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/50">Plain-language privacy</p>
            <h3 className="mt-1 font-display text-2xl font-bold">Private by design</h3>
          </div>
          <button onClick={onClose} aria-label="Close privacy dialog" className="rounded-full p-2 hover:bg-ink/5">
            <Icon name="x" className="size-5" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          {SECTIONS.map((s) => (
            <div key={s.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lime">
                <Icon name={s.icon} className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink/70">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-7 rounded-2xl border border-ink/10 bg-white/70 p-4">
          {cleared ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-mint">
              <Icon name="check" /> All local data cleared.
            </p>
          ) : confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">Delete saved scorecards and drafts on this device?</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onClearData();
                    setCleared(true);
                  }}
                >
                  Yes, clear
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink/70">Remove everything CareerAgent saved in this browser.</p>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
                <Icon name="trash" /> Clear my data
              </Button>
            </div>
          )}
        </div>

        <p className="mt-5 text-xs leading-relaxed text-ink/50">
          AI feedback is a coaching aid, not a hiring decision. Analysis powered by Google Gemini.
        </p>
      </div>
    </div>
  );
}
