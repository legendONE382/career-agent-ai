import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "careeragent.install.dismissedAt";
const DISMISS_DAYS = 30;

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function dismissedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t > 0 && Date.now() - t < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export interface InstallState {
  canInstall: boolean;
  isIOS: boolean;
  installed: boolean;
  dismissed: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  dismiss: () => void;
}

export function useInstall(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    () => ((window as unknown as { __capInstallPrompt?: Event }).__capInstallPrompt as BeforeInstallPromptEvent) ?? null,
  );
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(dismissedRecently);

  useEffect(() => {
    const stash = () => {
      const e = (window as unknown as { __capInstallPrompt?: Event }).__capInstallPrompt as BeforeInstallPromptEvent | undefined;
      if (e) setDeferred(e);
    };
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    const onDisplay = () => setInstalled(isStandalone());
    window.addEventListener("cap-install-ready", stash);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", onDisplay);
    return () => {
      window.removeEventListener("cap-install-ready", stash);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onDisplay);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferred) return "unavailable";
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      (window as unknown as { __capInstallPrompt?: Event }).__capInstallPrompt = undefined;
      if (choice.outcome === "accepted") setInstalled(true);
      return choice.outcome;
    } catch {
      setDeferred(null);
      return "unavailable";
    }
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  }, []);

  return { canInstall: !!deferred && !installed, isIOS: isIOSDevice(), installed, dismissed, promptInstall, dismiss };
}
