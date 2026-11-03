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
  const onViolationRef = useRef(onViolation);
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  const [status, setStatus] = useState<ObjectDetectStatus>("idle");
  const [boxes, setBoxes] = useState<DetectionBox[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastPhoneLogAt = 0;
    let lastCaptureWaitLogAt = 0;
    let frameWidth = 0;
    let frameHeight = 0;

    // Phone confidence is already thresholded by the detector; cooldown prevents repeat reports.
    const gatePhone = createSignalGate(0, DETECT.cooldownMs);
    const gateObject = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);
    const gatePerson = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);

    // Spawn worker
    const worker = new Worker(new URL("../workers/yolo.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.postMessage({ type: "init" });

    worker.onmessage = (e: MessageEvent) => {
      const { type, boxes: detBoxes, phoneCandidates, maxPhoneScore } = e.data as {
        type: string;
        boxes?: DetectionBox[];
        phoneCandidates?: DetectionBox[];
        maxPhoneScore?: number;
      };

      if (type === "loading") {
        if (!stopped) setStatus("loading");
        return;
      }

      if (type === "ready") {
        if (!stopped) {
          console.info("[phone-detect] model ready", {
            phoneThreshold: DETECT.phoneScore,
            objectThreshold: DETECT.objectScore,
          });
          setStatus("ready");
          scheduleNext();
        }
        return;
      }

      if (type === "error") {
        if (!stopped) {
          setBoxes([]);
          setStatus("unavailable");
          console.error("[object-detect]", e.data.message);
        }
        return;
      }

      if (type === "result" && detBoxes) {
        if (stopped) return;
        setBoxes(detBoxes);

        const now = Date.now();
        const persons = detBoxes.filter((b) => b.label === "person");
        const phones = detBoxes.filter((b) => PHONE_LABELS.has(b.label));
        const objects = detBoxes.filter((b) => OBJECT_LABELS.has(b.label) || PHONE_LABELS.has(b.label));

        if (now - lastPhoneLogAt >= 2000) {
          console.info("[phone-detect] frame result", {
            cameraResolution: `${frameWidth}x${frameHeight}`,
            foundPhone: phones.length > 0,
            phoneThreshold: DETECT.phoneScore,
            maxPhoneConfidence: Number((maxPhoneScore ?? 0).toFixed(3)),
            detectedPhones: phones.map((phone) => ({
              confidence: Number(phone.score.toFixed(3)),
              box: {
                x: Number(phone.x.toFixed(3)),
                y: Number(phone.y.toFixed(3)),
                width: Number(phone.width.toFixed(3)),
                height: Number(phone.height.toFixed(3)),
              },
            })),
            topPhoneCandidates: (phoneCandidates ?? []).map((candidate) => ({
              confidence: Number(candidate.score.toFixed(3)),
              box: {
                x: Number(candidate.x.toFixed(3)),
                y: Number(candidate.y.toFixed(3)),
                width: Number(candidate.width.toFixed(3)),
                height: Number(candidate.height.toFixed(3)),
              },
            })),
          });
          lastPhoneLogAt = now;
        }

        if (phones.length > 0 && gatePhone.update(true, now)) {
          const bestPhone = phones.reduce((a, b) => (a.score > b.score ? a : b));
          onViolationRef.current({
            type: "object_detected",
            reason: `cell phone detected (${Math.round(bestPhone.score * 100)}%)`,
            confidence: bestPhone.score,
          });
          console.info("[phone-detect] violation reported", {
            confidence: Number(bestPhone.score.toFixed(3)),
          });
        } else if (phones.length === 0) {
          gatePhone.update(false, now);
        }

        const otherObjects = objects.filter((object) => !PHONE_LABELS.has(object.label));
        if (otherObjects.length > 0 && gateObject.update(true, now)) {
          const best = otherObjects.reduce((a, b) => (a.score > b.score ? a : b));
          onViolationRef.current({
            type: "object_detected",
            reason: `${best.label} detected (${Math.round(best.score * 100)}%)`,
            confidence: best.score,
          });
        } else if (otherObjects.length === 0) {
          gateObject.update(false, now);
        }

        if (persons.length >= 2 && gatePerson.update(true, now)) {
          onViolationRef.current({
            type: "multiple_persons",
            reason: `${persons.length} people in frame`,
            confidence: Math.max(...persons.map((p) => p.score)),
          });
        } else if (persons.length < 2) {
          gatePerson.update(false, now);
        }

        scheduleNext();
      }
    };

    worker.onerror = () => {
      if (!stopped) setStatus("unavailable");
    };

    function scheduleNext() {
      if (stopped) return;
      timeoutId = setTimeout(captureAndSend, DETECT.objectIntervalMs);
    }

    function captureAndSend() {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        const now = Date.now();
        if (now - lastCaptureWaitLogAt >= 5000) {
          console.warn("[phone-detect] waiting for camera video frame", {
            videoElementAvailable: Boolean(video),
            readyState: video?.readyState ?? null,
            streamActive: video?.srcObject instanceof MediaStream
              ? video.srcObject.active
              : false,
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
      const oc = new OffscreenCanvas(W, H);
      const ctx = oc.getContext("2d");
      if (!ctx) {
        scheduleNext();
        return;
      }
      ctx.drawImage(video, 0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);
      worker.postMessage({
        type: "detect",
        imageData,
        width: W,
        height: H,
        scoreThresh: DETECT.objectScore,
        phoneScoreThresh: DETECT.phoneScore,
        iouThresh: DETECT.objectIou,
      }, [imageData.data.buffer]);
    }

    return () => {
      stopped = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      worker.terminate();
    };
  }, [enabled, videoRef]);

  return {
    status: enabled ? status : "idle",
    boxes: enabled ? boxes : [],
  };
}
