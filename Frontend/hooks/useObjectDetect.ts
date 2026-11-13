"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { DETECT } from "@/lib/config";
import { createSignalGate } from "@/lib/signalGate";
import type { DetectionBox, ViolationReport } from "@/lib/types";

type Emit = (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void;

export type ObjectDetectStatus = "idle" | "loading" | "ready" | "unavailable";

const PHONE_LABELS = new Set(["cell phone"]);
const OBJECT_LABELS = new Set(["book", "laptop", "tv", "keyboard", "mouse", "remote"]);

export function useObjectDetect(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onViolation: Emit,
) {
  // State
  const [status, setStatus] = useState<ObjectDetectStatus>("idle");
  const [boxes, setBoxes] = useState<DetectionBox[]>([]);

  // Keep latest onViolation callback without re‑creating effect closures
  const onViolationRef = useRef(onViolation);
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  // Main detection effect
  useEffect(() => {
    if (!enabled) {
      console.debug("[ObjectDetect] disabled – skipping setup");
      return;
    }
    console.debug("[ObjectDetect] hook init", { enabled });

    // ---- Runtime variables ----
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastPhoneLogAt = 0;
    let lastCaptureWaitLogAt = 0;
    let frameWidth = 0;
    let frameHeight = 0;
    let consecutivePhoneFrames = 0;

    const gatePhone = createSignalGate(0, DETECT.cooldownMs);
    const gateObject = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);
    const gatePerson = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);

    // ---- Worker setup ----
    const worker = new Worker(new URL('../workers/yolo.worker.ts', import.meta.url), {
      type: 'module',
    });
    console.debug("[ObjectDetect] worker instantiated");
    worker.postMessage({ type: 'init' });
    console.debug("[ObjectDetect] init message sent to worker");

    worker.onmessage = (e: MessageEvent) => {
      const { type, boxes: detBoxes, phoneCandidates, maxPhoneScore } = e.data as {
        type: string;
        boxes?: DetectionBox[];
        phoneCandidates?: DetectionBox[];
        maxPhoneScore?: number;
      };
      console.debug("[ObjectDetect] worker message", { type, boxesCount: detBoxes?.length });

      if (type === 'loading') {
        if (!stopped) setStatus('loading');
        return;
      }
      if (type === 'ready') {
        if (!stopped) {
          console.info('[ObjectDetect] model ready', {
            phoneThreshold: DETECT.phoneScore,
            objectThreshold: DETECT.objectScore,
          });
          setStatus('ready');
          scheduleNext();
        }
        return;
      }
      if (type === 'error') {
        if (!stopped) {
          setBoxes([]);
          setStatus('unavailable');
          console.error('[ObjectDetect] error from worker', (e.data as any).message);
        }
        return;
      }
      if (type === 'result' && detBoxes) {
        if (stopped) return;
        console.debug('[ObjectDetect] processing result', { detBoxesLength: detBoxes.length });
        setBoxes(detBoxes);
        const now = Date.now();
        const persons = detBoxes.filter(b => b.label === 'person');
        const phones = detBoxes.filter(b => PHONE_LABELS.has(b.label));
        // Debug: log raw phone detections before any area filter
        if (process.env.NODE_ENV === 'development') {
          console.debug('[ObjectDetect] raw phone detections', {
            count: phones.length,
            details: phones.map(p => ({
              confidence: Number(p.score.toFixed(3)),
              area: Number((p.width * p.height).toFixed(5)),
            })),
          });
        }
        const objects = detBoxes.filter(b => OBJECT_LABELS.has(b.label) || PHONE_LABELS.has(b.label));

        // ---- Person logs (dev only) ----
        if (process.env.NODE_ENV === 'development') {
          persons.forEach(p => {
            console.debug('[ObjectDetect] person detection', {
              confidence: Number(p.score.toFixed(3)),
              bbox: {
                x: Number(p.x.toFixed(3)),
                y: Number(p.y.toFixed(3)),
                width: Number(p.width.toFixed(3)),
                height: Number(p.height.toFixed(3)),
              },
            });
          });
        }

        // ---- Phone logging (throttled) ----
        if (now - lastPhoneLogAt >= 2000) {
          console.info('[ObjectDetect] phone frame result', {
            cameraResolution: `${frameWidth}x${frameHeight}`,
            foundPhone: phones.length > 0,
            phoneThreshold: DETECT.phoneScore,
            maxPhoneConfidence: Number((maxPhoneScore ?? 0).toFixed(3)),
            detectedPhones: phones.map(phone => ({
              confidence: Number(phone.score.toFixed(3)),
              box: { x: Number(phone.x.toFixed(3)), y: Number(phone.y.toFixed(3)), width: Number(phone.width.toFixed(3)), height: Number(phone.height.toFixed(3)) },
            })),
            topPhoneCandidates: (phoneCandidates ?? []).map(c => ({
              confidence: Number(c.score.toFixed(3)),
              box: { x: Number(c.x.toFixed(3)), y: Number(c.y.toFixed(3)), width: Number(c.width.toFixed(3)), height: Number(c.height.toFixed(3)) },
            })),
          });
          lastPhoneLogAt = now;
        }

        // ---- Phone detection flow ----
        consecutivePhoneFrames = phones.length > 0 ? consecutivePhoneFrames + 1 : 0;
        if (consecutivePhoneFrames >= DETECT.phoneConfirmFrames && gatePhone.update(true, now)) {
          const bestPhone = phones.reduce((a, b) => (a.score > b.score ? a : b));
          onViolationRef.current({ type: 'object_detected', reason: `cell phone detected (${Math.round(bestPhone.score * 100)}%)`, confidence: bestPhone.score });
          console.info('[ObjectDetect] phone violation reported', { confidence: Number(bestPhone.score.toFixed(3)) });
        } else if (phones.length === 0) {
          gatePhone.update(false, now);
        }

        // ---- Object detection flow (non‑phone) ----
        const otherObjects = objects.filter(o => !PHONE_LABELS.has(o.label));
        if (otherObjects.length > 0 && gateObject.update(true, now)) {
          const best = otherObjects.reduce((a, b) => (a.score > b.score ? a : b));
          onViolationRef.current({ type: 'object_detected', reason: `${best.label} detected (${Math.round(best.score * 100)}%)`, confidence: best.score });
          console.info('[ObjectDetect] object violation reported', { label: best.label, confidence: Number(best.score.toFixed(3)) });
        } else if (otherObjects.length === 0) {
          gateObject.update(false, now);
        }

        // ---- Multiple persons detection ----
        if (persons.length >= 2 && gatePerson.update(true, now)) {
          onViolationRef.current({
            type: 'multiple_persons',
            reason: `${persons.length} people in frame`,
            confidence: Math.max(...persons.map(p => p.score)),
          });
          console.warn('[ObjectDetect] multiple persons violation', { count: persons.length });
        } else if (persons.length < 2) {
          gatePerson.update(false, now);
        }

        scheduleNext();
      }
    };

    worker.onerror = () => {
      if (!stopped) {
        setStatus('unavailable');
        console.error('[ObjectDetect] worker error');
      }
    };

    function scheduleNext() {
      if (stopped) return;
      console.debug('[ObjectDetect] scheduling next capture in', DETECT.objectIntervalMs, 'ms');
      timeoutId = setTimeout(captureAndSend, DETECT.objectIntervalMs);
    }

    function captureAndSend() {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        const now = Date.now();
        if (now - lastCaptureWaitLogAt >= 5000) {
          console.warn('[ObjectDetect] waiting for camera video frame', {
            videoElementAvailable: Boolean(video),
            readyState: video?.readyState ?? null,
            streamActive: video?.srcObject instanceof MediaStream ? video.srcObject.active : false,
          });
          lastCaptureWaitLogAt = now;
        }
        scheduleNext();
        return;
      }
      const W = video.videoWidth || 640;
      const H = video.videoHeight || 480;
      frameWidth = W;
      frameHeight = H;
      console.debug('[ObjectDetect] captured frame', { width: W, height: H });
      const width = Math.max(1, Math.floor(W));
      const height = Math.max(1, Math.floor(H));
      console.debug('[ObjectDetect] creating OffscreenCanvas', { width, height });
      const oc = new OffscreenCanvas(width, height);
      const ctx = oc.getContext('2d');
      if (!ctx) {
        console.error('[ObjectDetect] OffscreenCanvas 2d context not available');
        scheduleNext();
        return;
      }
      ctx.drawImage(video, 0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);
      console.debug('[ObjectDetect] sending image data to worker');
      worker.postMessage({
        type: 'detect',
        imageData,
        width: W,
        height: H,
        scoreThresh: DETECT.objectScore,
        phoneScoreThresh: DETECT.phoneScore,
      }, [imageData.data.buffer]);
    }

    // Cleanup on unmount / disabled
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      worker.terminate();
      console.info('[ObjectDetect] cleanup: stopped and worker terminated');
    };
  }, [enabled, videoRef]);

  return { status, boxes };
}
