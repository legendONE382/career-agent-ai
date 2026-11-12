import type { BackendInfo } from "../lib/gemini";
import type { Stage } from "../types";
import { cn } from "../utils/cn";
import { Icon, Logo } from "./ui";

const STEPS: { label: string; stages: Stage[] }[] = [
  { label: "Tailor", stages: ["setup", "review"] },
  { label: "Interview", stages: ["lobby", "interview", "analyzing"] },
  { label: "Scorecard", stages: ["results"] },
];

interface Props {
  stage: Stage;
  backend: BackendInfo | null;
  demo: boolean;
  online: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onHome: () => void;
  onExitDemo: () => void;
}

export function Header({ stage, backend, demo, online, canInstall, onInstall, onHome, onExitDemo }: Props) {
  const current = STEPS.findIndex((s) => s.stages.includes(stage));

  let pill: { text: string; short: string; cls: string; dot: string };
  if (demo) {
    pill = { text: "Sample mode", short: "Sample", cls: "border-amber/40 bg-amber/15 text-[#8a5a00]", dot: "bg-amber" };
  } else if (!online) {
    pill = { text: "Offline", short: "Offline", cls: "border-ink/15 bg-white/60 text-ink/60", dot: "bg-ink/35" };
  } else if (!backend) {
    pill = { text: "Connecting…", short: "…", cls: "border-ink/10 bg-white/60 text-ink/60", dot: "bg-ink/30 animate-pulse" };
  } else if (backend.kind === "none") {
    pill = { text: "Reconnecting…", short: "…", cls: "border-amber/40 bg-amber/15 text-[#8a5a00]", dot: "bg-amber animate-pulse" };
  } else {
    pill = { text: "AI online", short: "Live", cls: "border-mint/30 bg-mint/10 text-[#0e7a53]", dot: "bg-mint" };
  }

  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-cobalt" aria-label="CareerAgent.ai home">
          <Logo />
          <span className="font-display text-xl font-bold tracking-tight">
            CareerAgent<span className="text-ink/40">.ai</span>
          </span>
        </button>

        <ol className="hidden items-center gap-1 md:flex" aria-label="Progress">
          {STEPS.map((s, i) => {
            const active = i === current;
            const done = i < current;
            return (
              <li key={s.label} className="flex items-center gap-1">
                <span
                  className={cn(
                    "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                    active ? "bg-ink text-paper" : done ? "text-ink" : "text-ink/45",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full font-mono text-[11px]",
                      active ? "bg-lime text-ink" : done ? "bg-mint text-white" : "bg-ink/10",
                    )}
                  >
                    {done ? <Icon name="check" className="size-3" /> : i + 1}
                  </span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="h-px w-6 bg-ink/15" />}
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2">
          {canInstall && (
            <button
              onClick={onInstall}
              title="Install the app"
              aria-label="Install the app"
              className="grid size-9 place-items-center rounded-full border border-ink/12 bg-white/70 text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              <Icon name="download" />
            </button>
          )}
          <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium", pill.cls)}>
            <span className={cn("size-2 rounded-full", pill.dot)} />
            <span className="hidden sm:inline">{pill.text}</span>
            <span className="sm:hidden">{pill.short}</span>
          </span>
          {demo && (
            <button onClick={onExitDemo} className="rounded-full px-2 py-1 text-xs font-semibold text-ink/60 underline underline-offset-2 hover:text-ink">
              Exit
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
