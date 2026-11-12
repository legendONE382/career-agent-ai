import { useEffect, useState } from "react";
import type { InstallState } from "../lib/useInstall";
import { Button, Icon, Logo } from "./ui";

interface Props {
  install: InstallState;
  visible: boolean;
}

/** Friendly, dismissible install nudge. Native prompt on Chromium; guided steps on iOS. */
export function InstallBanner({ install, visible }: Props) {
  const [iosOpen, setIosOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!iosOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIosOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [iosOpen]);

  if (!visible || hidden || install.installed || install.dismissed) return null;
  if (!install.canInstall && !install.isIOS) return null;

  async function handleInstall() {
    if (install.isIOS && !install.canInstall) {
      setIosOpen(true);
      return;
    }
    setBusy(true);
    const outcome = await install.promptInstall();
    setBusy(false);
    if (outcome === "accepted") setHidden(true);
    if (outcome === "unavailable" && install.isIOS) setIosOpen(true);
  }

  return (
    <>
      <div
        role="region"
        aria-label="Install CareerAgent"
        className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md animate-fade-up rounded-3xl border border-white/10 bg-ink p-4 text-paper shadow-2xl shadow-ink/40 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px]"
      >
        <div className="flex items-start gap-3.5">
          <Logo className="size-11 shrink-0 rounded-2xl bg-ink-3" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[17px] font-bold leading-tight">Get the CareerAgent app</p>
            <p className="mt-1 text-[13px] leading-snug text-paper/65">
              One tap from your home screen. Your saved scorecards even work offline.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="lime" size="sm" onClick={() => void handleInstall()} loading={busy}>
                <Icon name="download" /> {install.canInstall ? "Install" : "How to install"}
              </Button>
              <Button
                variant="darkGhost"
                size="sm"
                onClick={() => {
                  install.dismiss();
                  setHidden(true);
                }}
              >
                Not now
              </Button>
            </div>
          </div>
          <button
            onClick={() => {
              install.dismiss();
              setHidden(true);
            }}
            aria-label="Dismiss install suggestion"
            className="rounded-full p-1 text-paper/50 hover:bg-white/10 hover:text-paper"
          >
            <Icon name="x" />
          </button>
        </div>
      </div>

      {iosOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm" onClick={() => setIosOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Install on iPhone or iPad"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm animate-fade-up rounded-3xl bg-paper p-6 text-ink shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-bold">Install on iPhone / iPad</h3>
              <button onClick={() => setIosOpen(false)} aria-label="Close" className="rounded-full p-1.5 hover:bg-ink/5">
                <Icon name="x" />
              </button>
            </div>
            <ol className="mt-4 space-y-4 text-sm leading-relaxed text-ink/80">
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs text-lime">1</span>
                <span>
                  Tap the <strong>Share</strong> button in Safari
                  <svg viewBox="0 0 24 24" className="mx-1 inline size-4 -translate-y-px" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <path d="m16 6-4-4-4 4" />
                    <path d="M12 2v13" />
                  </svg>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs text-lime">2</span>
                <span>
                  Choose <strong>“Add to Home Screen”</strong>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs text-lime">3</span>
                <span>
                  Tap <strong>Add</strong> — CareerAgent appears with your apps.
                </span>
              </li>
            </ol>
            <Button className="mt-6 w-full" onClick={() => setIosOpen(false)}>
              Got it
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
