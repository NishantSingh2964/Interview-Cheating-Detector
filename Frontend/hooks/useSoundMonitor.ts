"use client";

import { useEffect, useRef, useState } from "react";
import { DETECT } from "@/lib/config";
import { createSignalGate } from "@/lib/signalGate";
import type { ViolationReport } from "@/lib/types";

type Emit = (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void;

export type SoundStatus = "idle" | "listening" | "unavailable";

export function useSoundMonitor(stream: MediaStream | null, enabled: boolean, onViolation: Emit) {
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;
  const [status, setStatus] = useState<SoundStatus>("idle");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!enabled || !stream) {
      setStatus("idle");
      setLevel(0);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      setStatus("unavailable");
      setLevel(0);
      return;
    }

    let stopped = false;
    let frame = 0;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const gate = createSignalGate(DETECT.soundMs, DETECT.cooldownMs);

    setStatus("listening");

    const tick = () => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      let crossings = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const value = samples[i];
        sum += value * value;
        if (i > 0) {
          const prev = samples[i - 1];
          if ((value >= 0 && prev < 0) || (value < 0 && prev >= 0)) crossings += 1;
        }
      }
      const rms = Math.sqrt(sum / samples.length);
      const zeroCrossing = crossings / samples.length;
      const speechLike = zeroCrossing > 0.02 && zeroCrossing < 0.3;
      setLevel(rms);
      if (gate.update(rms >= DETECT.soundRms, Date.now())) {
        onViolationRef.current({
          type: "sound",
          reason: speechLike
            ? "Sustained speech or loud noise"
            : "Sustained loud noise",
          confidence: Math.min(1, rms / 0.25),
        });
      }
    };

    void context.resume().then(() => {
      if (!stopped) frame = requestAnimationFrame(tick);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [enabled, stream]);

  return { status, level };
}
