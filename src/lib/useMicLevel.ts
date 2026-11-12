import { useEffect, useState } from "react";

/** Live microphone loudness (0–1) from a MediaStream using the Web Audio API. */
export function useMicLevel(stream: MediaStream | null, active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !active || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }
    const AudioCtx: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let raf = 0;
    let last = 0;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    try {
      ctx = new AudioCtx();
      void ctx.resume().catch(() => {});
      source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const tick = (t: number) => {
        raf = requestAnimationFrame(tick);
        if (t - last < 60) return; // ~16 fps is plenty for a meter
        last = t;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* meter is a nice-to-have */
    }

    return () => {
      cancelAnimationFrame(raf);
      try {
        source?.disconnect();
        void ctx?.close();
      } catch {
        /* ignore */
      }
      setLevel(0);
    };
  }, [stream, active]);

  return level;
}
