"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { DETECT } from "@/lib/config";
import { createSignalGate } from "@/lib/signalGate";
import type { ViolationReport } from "@/lib/types";

/**
 * Hook that records a short voice reference from the candidate and then
 * continuously compares live microphone audio against that reference.
 *
 * When the similarity falls below DETECT.voiceOtherThreshold it reports an
 * "other_voice" violation.  An optional "candidate_voice" event could be used
 * for positive feedback (based on DETECT.voiceCandidateThreshold).
 */
export function useVoiceMonitor(
  audioRef: RefObject<HTMLAudioElement | null>, // kept for API parity; not used internally
  enabled: boolean,
  onViolation: (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void,
) {
  // Keep the latest callback stable across renders
  const onViolationRef = useRef(onViolation);
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  const [status, setStatus] = useState<"idle" | "recording" | "monitoring" | "unavailable">(
    "idle",
  );

  useEffect(() => {
    if (!enabled) {
      console.debug("[VoiceMonitor] disabled – skipping setup");
      return;
    }
    console.debug("[VoiceMonitor] hook init", { enabled });

    let stopped = false;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let dataArray: Float32Array | null = null;
    const referenceRms: number[] = [];
    const liveRmsWindow: number[] = [];
    const REFERENCE_MS = 3000; // 3 seconds of candidate voice
    const CHUNK_MS = 100; // how often we sample
    const gateOther = createSignalGate(0, DETECT.cooldownMs);
  const gateCandidate = createSignalGate(0, DETECT.cooldownMs);
    let lastViolationAt = 0;

    // ---------------------------------------------------
    // Helper: RMS of a Float32Array (same as useAudioMonitor)
    // ---------------------------------------------------
    function computeRms(buf: Float32Array): number {
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    }

    // ---------------------------------------------------
    // Step 1: Record a reference sample of the candidate
    // ---------------------------------------------------
    async function startReferenceCapture() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (stopped) return;
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        dataArray = new Float32Array(analyser.frequencyBinCount);
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        setStatus("recording");
        console.info("[VoiceMonitor] microphone granted – recording candidate reference");

        const start = Date.now();
        const recordChunk = () => {
          if (stopped) return;
          if (!analyser || !dataArray) return;
          analyser.getFloatTimeDomainData(dataArray);
          const rms = computeRms(dataArray);
          referenceRms.push(rms);
          if (Date.now() - start < REFERENCE_MS) {
            setTimeout(recordChunk, CHUNK_MS);
          } else {
            // Reference done – move to live monitoring
            setStatus("monitoring");
            console.info("[VoiceMonitor] reference captured – starting live monitoring");
            liveLoop();
          }
        };
        recordChunk();
      } catch (err) {
        console.error("[VoiceMonitor] error accessing microphone", err);
        setStatus("unavailable");
      }
    }

    // ---------------------------------------------------
    // Step 2: Live monitoring loop – compare to reference
    // ---------------------------------------------------
    export function computeSimilarity(reference: number[], live: number[]): number {
      const n = Math.min(reference.length, live.length);
      if (n === 0) return 0;
      let sumRef = 0,
        sumLive = 0,
        sumRefSq = 0,
        sumLiveSq = 0,
        sumProd = 0;
      for (let i = 0; i < n; i++) {
        const r = reference[i];
        const l = live[i];
        sumRef += r;
        sumLive += l;
        sumRefSq += r * r;
        sumLiveSq += l * l;
        sumProd += r * l;
      }
      const numerator = n * sumProd - sumRef * sumLive;
      const denominator = Math.sqrt((n * sumRefSq - sumRef * sumRef) * (n * sumLiveSq - sumLive * sumLive));
      return denominator === 0 ? 0 : numerator / denominator;
    }
      const n = Math.min(reference.length, live.length);
      if (n === 0) return 0;
      let sumRef = 0,
        sumLive = 0,
        sumRefSq = 0,
        sumLiveSq = 0,
        sumProd = 0;
      for (let i = 0; i < n; i++) {
        const r = reference[i];
        const l = live[i];
        sumRef += r;
        sumLive += l;
        sumRefSq += r * r;
        sumLiveSq += l * l;
        sumProd += r * l;
      }
      const numerator = n * sumProd - sumRef * sumLive;
      const denominator = Math.sqrt((n * sumRefSq - sumRef * sumRef) * (n * sumLiveSq - sumLive * sumLive));
      return denominator === 0 ? 0 : numerator / denominator;
    }

      if (stopped) return;
      if (!analyser || !dataArray) return;

      analyser.getFloatTimeDomainData(dataArray);
      const rms = computeRms(dataArray);

      // Keep sliding window same length as reference
      liveRmsWindow.push(rms);
      if (liveRmsWindow.length > referenceRms.length) liveRmsWindow.shift();

      // Compute a simple Pearson‑like correlation as similarity
      const n = Math.min(referenceRms.length, liveRmsWindow.length);
      if (n > 0) {
        let sumRef = 0,
          sumLive = 0,
          sumRefSq = 0,
          sumLiveSq = 0,
          sumProd = 0;
        for (let i = 0; i < n; i++) {
          const r = referenceRms[i];
          const l = liveRmsWindow[i];
          sumRef += r;
          sumLive += l;
          sumRefSq += r * r;
          sumLiveSq += l * l;
          sumProd += r * l;
        }
        const numerator = n * sumProd - sumRef * sumLive;
        const denominator = Math.sqrt(
          (n * sumRefSq - sumRef * sumRef) * (n * sumLiveSq - sumLive * sumLive),
        );
        const similarity = denominator === 0 ? 0 : numerator / denominator; // ≈ -1..1

        // Debug (dev only)
        if (process.env.NODE_ENV === "development") {
          console.debug("[VoiceMonitor] similarity", {
            similarity: Number(similarity.toFixed(3)),
            rms,
          });
        }

        const now = Date.now();
        const similarity = computeSimilarity(referenceRms, liveRmsWindow);
        // Debug (dev only)
        if (process.env.NODE_ENV === "development") {
          console.debug("[VoiceMonitor] similarity", {
            similarity: Number(similarity.toFixed(3)),
            rms,
          });
        }
        if (similarity < DETECT.voiceOtherThreshold) {
          // Other voice detected – apply gating to avoid spamming
          if (gateOther.update(true, now)) {
            onViolationRef.current({
              type: "other_voice",
              reason: "Detected voice different from candidate",
              confidence: similarity,
            });
            console.warn("[VoiceMonitor] other_voice violation", { similarity });
            lastViolationAt = now;
          }
        } else if (similarity >= DETECT.voiceCandidateThreshold) {
          // Candidate voice detected – separate gating
          if (gateCandidate.update(true, now)) {
            onViolationRef.current({
              type: "candidate_voice",
              reason: "Detected candidate voice",
              confidence: similarity,
            });
            console.info("[VoiceMonitor] candidate_voice detected", { similarity });
          }
        } else {
          // No violation – reset gates
          gateOther.update(false, now);
          gateCandidate.update(false, now);
        }
            // Other voice detected – apply gating to avoid spamming
            if (gateOther.update(true, now)) {
              onViolationRef.current({
                type: "other_voice",
                reason: "Detected voice different from candidate",
                confidence: similarity,
              });
              console.warn("[VoiceMonitor] other_voice violation", { similarity });
              lastViolationAt = now;
            }
          } else if (similarity >= DETECT.voiceCandidateThreshold) {
            // Candidate voice detected – separate gating
            if (gateCandidate.update(true, now)) {
              onViolationRef.current({
                type: "candidate_voice",
                reason: "Detected candidate voice",
                confidence: similarity,
              });
              console.info("[VoiceMonitor] candidate_voice detected", { similarity });
            }
          } else {
            // No violation – reset gates
            gateOther.update(false, now);
            gateCandidate.update(false, now);
          }
          // Other voice detected – apply gating to avoid spamming
          if (gateOther.update(true, now)) {
            onViolationRef.current({
              type: "other_voice",
              reason: "Detected voice different from candidate",
              confidence: similarity,
            });
            console.warn("[VoiceMonitor] other_voice violation", { similarity });
            lastViolationAt = now;
          }
        } else {
          gateOther.update(false, now);
        }
      }

      // Schedule next check
      setTimeout(liveLoop, CHUNK_MS);
    }

    // Kick off reference capture when the hook activates
    startReferenceCapture();

    // Cleanup when disabled/unmounted
    return () => {
      stopped = true;
      setStatus("idle");
      if (source) source.disconnect();
      if (analyser) analyser.disconnect();
      if (audioCtx) audioCtx.close();
      console.info("[VoiceMonitor] cleanup – stopped listening");
    };
  }, [enabled, audioRef]);

  return { status };
}
