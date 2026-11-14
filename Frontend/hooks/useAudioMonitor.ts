"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { DETECT } from "@/lib/config";
import { createSignalGate } from "@/lib/signalGate";
import type { ViolationReport } from "@/lib/types";

/**
 * Hook that monitors microphone audio levels and emits a "sound" violation
 * when the RMS amplitude stays above DETECT.soundRms for DETECT.soundMs ms.
 *
 * It uses the Web Audio API (AudioContext + AnalyserNode) to compute the
 * root‑mean‑square of the latest audio buffer.
 */
export function useAudioMonitor(
  audioRef: RefObject<HTMLAudioElement | null>, // optional, not used but keeps signature similar
  enabled: boolean,
  onViolation: (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void,
) {
  const onViolationRef = useRef(onViolation);
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  const [status, setStatus] = useState<"idle" | "listening" | "unavailable">("idle");

  useEffect(() => {
    if (!enabled) {
      console.debug("[AudioMonitor] disabled – skipping setup");
      return;
    }
    console.debug("[AudioMonitor] hook init", { enabled });

    let stopped = false;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let dataArray: Float32Array<ArrayBuffer> | null = null;
    let lastViolationAt = 0;
    const gateSound = createSignalGate(0, DETECT.cooldownMs);

    async function startMonitoring() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (stopped) return;
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        dataArray = new Float32Array(analyser.frequencyBinCount);
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        setStatus("listening");
        console.info("[AudioMonitor] microphone access granted and listening started");
        monitorLoop();
      } catch (err) {
        console.error("[AudioMonitor] error accessing microphone", err);
        setStatus("unavailable");
      }
    }

    function computeRms(buffer: Float32Array): number {
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      return Math.sqrt(sum / buffer.length);
    }

    function monitorLoop() {
      if (stopped) return;
      if (!analyser || !dataArray) return;
      analyser.getFloatTimeDomainData(dataArray);
      const rms = computeRms(dataArray);

      // Debug log (dev only)
      if (process.env.NODE_ENV === "development") {
        console.debug("[AudioMonitor] rms", { rms: Number(rms.toFixed(3)) });
      }

      const now = Date.now();
      if (rms >= DETECT.soundRms) {
        // If the sound stays above threshold for the configured interval
        if (now - lastViolationAt >= DETECT.soundMs && gateSound.update(true, now)) {
          onViolationRef.current({
            type: "sound",
            reason: "Background noise detected",
            confidence: rms,
          });
          console.warn("[AudioMonitor] sound violation reported", { rms });
          lastViolationAt = now;
        }
      } else {
        gateSound.update(false, now);
      }

      // Schedule next check – we pick a short interval (100 ms) for responsiveness
      setTimeout(monitorLoop, 100);
    }

    startMonitoring();

    return () => {
      stopped = true;
      setStatus("idle");
      if (source) source.disconnect();
      if (analyser) analyser.disconnect();
      if (audioCtx) audioCtx.close();
      console.info("[AudioMonitor] cleanup: stopped listening");
    };
  }, [enabled, audioRef]);

  return { status };
}
