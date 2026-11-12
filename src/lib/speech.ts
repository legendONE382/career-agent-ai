/* Browser-native text-to-speech (window.speechSynthesis) — the free "interviewer voice". */

export const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

const PREFERRED = [
  /google us english/i,
  /google uk english female/i,
  /samantha/i,
  /microsoft (aria|jenny|guy|sonia|ryan).*online/i,
  /microsoft (aria|jenny|zira|david)/i,
  /daniel/i,
  /karen/i,
  /moira/i,
];

function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!speechSupported) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  for (const re of PREFERRED) {
    const hit = voices.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return voices.find((v) => v.default) || voices.find((v) => /^en-US/i.test(v.lang)) || voices[0];
}

export interface SpeakOptions {
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

/** Speaks text; returns a cancel function. onEnd always fires exactly once (even if the browser forgets to). */
export function speak(text: string, opts: SpeakOptions = {}): () => void {
  if (!speechSupported || !text.trim()) {
    opts.onEnd?.();
    return () => {};
  }
  const synth = window.speechSynthesis;
  let finished = false;
  let cancelled = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (!cancelled) opts.onEnd?.();
  };

  const rate = opts.rate ?? 1;
  // Chrome occasionally never fires `end`; fall back to a length-based timer.
  const watchdog = setTimeout(done, Math.max(5000, (text.length * 80 + 2500) / rate));

  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else u.lang = "en-US";
    u.rate = rate;
    u.pitch = 1;
    u.onstart = () => opts.onStart?.();
    u.onend = done;
    u.onerror = done;
    // Tiny delay avoids a Chrome race where cancel() immediately swallows the next utterance.
    setTimeout(() => {
      if (!cancelled && !finished) synth.speak(u);
    }, 60);
  } catch {
    done();
  }

  return () => {
    cancelled = true;
    finished = true;
    clearTimeout(watchdog);
    try {
      synth.cancel();
    } catch {
      /* ignore */
    }
  };
}

export function stopSpeaking() {
  if (!speechSupported) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/** Some browsers load voices asynchronously — warm them up early. */
export function warmUpVoices() {
  if (!speechSupported) return;
  try {
    window.speechSynthesis.getVoices();
  } catch {
    /* ignore */
  }
}
