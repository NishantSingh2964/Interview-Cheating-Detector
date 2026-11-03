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
  onViolationRef.current = onViolation;

  const [status, setStatus] = useState<ObjectDetectStatus>("idle");
  const [boxes, setBoxes] = useState<DetectionBox[]>([]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setBoxes([]);
      return;
    }

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Gates: one per "object" category and one for persons
    const gateObject = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);
    const gatePerson = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);

    setStatus("loading");

    // Spawn worker
    const worker = new Worker(new URL("../workers/yolo.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.postMessage({ type: "init" });

    worker.onmessage = (e: MessageEvent) => {
      const { type, boxes: detBoxes } = e.data as { type: string; boxes?: DetectionBox[] };

      if (type === "ready") {
        if (!stopped) {
          setStatus("ready");
          scheduleNext();
        }
        return;
      }

      if (type === "result" && detBoxes) {
        if (stopped) return;
        setBoxes(detBoxes);

        const now = Date.now();
        const persons = detBoxes.filter((b) => b.label === "person");
        const objects = detBoxes.filter((b) => OBJECT_LABELS.has(b.label) || PHONE_LABELS.has(b.label));

        if (objects.length > 0 && gateObject.update(true, now)) {
          const best = objects.reduce((a, b) => (a.score > b.score ? a : b));
          onViolationRef.current({
            type: "object_detected",
            reason: `${best.label} detected (${Math.round(best.score * 100)}%)`,
            confidence: best.score,
          });
        } else {
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
        scheduleNext();
        return;
      }
      const W = video.videoWidth || 640;
      const H = video.videoHeight || 480;
      const oc = new OffscreenCanvas(W, H);
      const ctx = oc.getContext("2d");
      if (!ctx) { scheduleNext(); return; }
      ctx.drawImage(video, 0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);
      worker.postMessage({
        type: "detect",
        imageData,
        width: W,
        height: H,
        scoreThresh: DETECT.objectScore,
        iouThresh: DETECT.objectIou,
      }, [imageData.data.buffer]);
    }

    return () => {
      stopped = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      worker.terminate();
      setBoxes([]);
      setStatus("idle");
    };
  }, [enabled, videoRef]);

  return { status, boxes };
}
