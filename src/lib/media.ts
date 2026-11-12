/* Camera / microphone / MediaRecorder helpers. Everything stays in browser memory. */

export const MAX_ANSWER_SECONDS = 90;
export const MIN_ANSWER_SECONDS = 3;

// Tuned so a 90 s answer stays ~2.6 MB: small enough for Vercel's 4.5 MB request limit once base64-encoded.
const VIDEO_BITS = 200_000;
const AUDIO_BITS = 32_000;

export const mediaSupported =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  typeof window !== "undefined" &&
  "MediaRecorder" in window;

export function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
}

export async function openCamera(): Promise<MediaStream> {
  if (!mediaSupported) {
    throw new Error("Your browser doesn't support camera recording. Try the latest Chrome, Edge, Firefox or Safari.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error("Camera or microphone access was blocked. Click the lock icon in your address bar, allow both, then retry.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new Error("No camera or microphone was found. Plug one in (or enable it in system settings) and retry.");
    }
    if (name === "NotReadableError") {
      throw new Error("Your camera or microphone is being used by another app. Close it and retry.");
    }
    throw new Error("Couldn't start your camera and microphone. Please check permissions and retry.");
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface ActiveRecording {
  stop: () => Promise<{ blob: Blob; mime: string; durationSec: number }>;
  cancel: () => void;
}

export function startRecording(stream: MediaStream): ActiveRecording {
  const mimeType = pickMimeType();
  const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS };
  if (mimeType) options.mimeType = mimeType;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, options);
  } catch {
    recorder = new MediaRecorder(stream);
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const startedAt = performance.now();
  recorder.start(1000); // collect light .webm chunks every second, kept only in RAM

  const finalMime = (recorder.mimeType || mimeType || "video/webm").split(";")[0] || "video/webm";

  return {
    stop: () =>
      new Promise((resolve) => {
        const finish = () => {
          resolve({
            blob: new Blob(chunks, { type: finalMime }),
            mime: finalMime,
            durationSec: (performance.now() - startedAt) / 1000,
          });
        };
        if (recorder.state === "inactive") return finish();
        recorder.onstop = finish;
        try {
          recorder.stop();
        } catch {
          finish();
        }
      }),
    cancel: () => {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
