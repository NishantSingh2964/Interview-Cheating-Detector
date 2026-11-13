// Frontend/hooks/useObjectMonitor.ts
// This hook runs the YOLOv8 ONNX model in the browser and emits violations.
// It now includes a dev‑only one‑liner that logs each person detection confidence.

import { useEffect, useRef } from "react";
import { DETECT } from "@/lib/config";
import type { ViolationReport } from "@/lib/types";
import { InferenceSession, Tensor } from "onnxruntime-web";

type Emit = (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void;

export function useObjectMonitor(
  videoRef: React.RefObject<HTMLVideoElement>,
  enabled: boolean,
  onViolation: Emit,
) {
  const onRef = useRef(onViolation);
  onRef.current = onViolation;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let frameId = 0;
    let lastRun = 0;
    let session: InferenceSession | null = null;
    let phoneStreak = 0;
    let personStreak = 0;

    // Load the ONNX model (YOLOv8) – adjust path if needed.
    (async () => {
      const modelPath = "/models/yolov8.onnx";
      session = await InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
    })();

    const loop = async () => {
      if (stopped || !session) return;
      frameId = requestAnimationFrame(loop as any);
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      const now = performance.now();
      if (now - lastRun < DETECT.objectIntervalMs) return;
      lastRun = now;

      // ----- Pre‑process frame into a Tensor -----
      const w = video.videoWidth;
      const h = video.videoHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const input = new Tensor("float32", Float32Array.from(img.data), [1, 3, h, w]);

      // ----- Run inference -----
      const feeds: Record<string, Tensor> = { images: input };
      const result = await session.run(feeds);
      // The output name may differ; we use the first output.
      const outName = Object.keys(result)[0];
      const detections = (result[outName].data as Float32Array);
      const arr = Array.from(detections);

      // ----- Process detections -----
      // YOLO output layout: [x1, y1, x2, y2, conf, classId, ...] per detection.
      const stride = 6; // we only need first 6 entries per box.
      for (let i = 0; i < arr.length; i += stride) {
        const x1 = arr[i];
        const y1 = arr[i + 1];
        const x2 = arr[i + 2];
        const y2 = arr[i + 3];
        const confidence = arr[i + 4];
        const classId = arr[i + 5];

        // Center‑mask check (70% of viewport) – same as phone logic.
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const inCenter = cx > 0.15 && cx < 0.85 && cy > 0.15 && cy < 0.85;
        if (!inCenter) continue;

        if (classId === 1 && confidence >= DETECT.phoneScore) {
          // Phone detection
          phoneStreak++;
          if (phoneStreak >= DETECT.phoneConfirmFrames) {
            onRef.current({
              type: "object_detected", // phone detection
              reason: "Phone detected near screen",
              confidence: 0.9,
            });
          }
        } else if (classId === 0 && confidence >= DETECT.personScore) {
          // Person detection (including back view)
          personStreak++;
          if (personStreak >= DETECT.personConfirmFrames) {
            onRef.current({
              type: "multiple_persons", // multiple people detected
              reason: "Multiple people detected",
              confidence: 0.9,
            });
          }
          // ---- One‑liner dev debug ----
          if (process.env.NODE_ENV === "development") {
            console.debug("[ObjectMonitor] person detection", {
              confidence,
              bbox: [x1, y1, x2, y2],
            });
          }
        } else {
          // reset streaks for non‑matching detections
          if (classId === 1) phoneStreak = 0;
          if (classId === 0) personStreak = 0;
        }
      }
    };

    frameId = requestAnimationFrame(loop as any);
    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
    };
  }, [enabled, videoRef]);
}
