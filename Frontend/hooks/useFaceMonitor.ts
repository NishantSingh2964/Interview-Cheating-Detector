"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { DETECT } from "@/lib/config";
import { createSignalGate } from "@/lib/signalGate";
import type { ViolationReport } from "@/lib/types";

type Emit = (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void;
type Landmark = { x: number; y: number };

export type FaceStatus = "idle" | "loading" | "ready" | "error";

function isLookingAway(landmarks: Landmark[]) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.08 || height < 0.08) return false;

  const nose = landmarks[1];
  if (!nose) return false;
  const relX = (nose.x - minX) / width;
  const relY = (nose.y - minY) / height;
  return relX < 0.34 || relX > 0.66 || relY < 0.28 || relY > 0.75;
}

export function useFaceMonitor(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onViolation: Emit,
) {
  const onViolationRef = useRef(onViolation);
  const [status, setStatus] = useState<FaceStatus>("idle");
  const [detail, setDetail] = useState("Face monitor is off");

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let frame = 0;
    let lastRun = 0;
    let landmarker: { close: () => void; detectForVideo: (video: HTMLVideoElement, ts: number) => { faceLandmarks: Landmark[][] } } | null = null;
    const away = createSignalGate(DETECT.lookingAwayMs, DETECT.cooldownMs);

    const loop = () => {
      if (stopped) return;
      frame = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!landmarker || !video || video.readyState < 2) return;
      const now = performance.now();
      if (now - lastRun < DETECT.faceIntervalMs) return;
      lastRun = now;

      let faces: Landmark[][] = [];
      try {
        faces = landmarker.detectForVideo(video, now).faceLandmarks ?? [];
      } catch {
        return;
      }

      const stamp = Date.now();

      const turned = faces.length === 1 && isLookingAway(faces[0]);
      if (away.update(turned, stamp)) {
        onViolationRef.current({
          type: "looking_away",
          reason: "Face turned away from the camera",
          confidence: 0.8,
        });
      }
    };

    (async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe");
        const create = (delegate: "GPU" | "CPU") =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "/models/face_landmarker.task",
              delegate,
            },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
          });

        try {
          landmarker = await create("GPU");
        } catch {
          landmarker = await create("CPU");
        }
        if (stopped) {
          landmarker.close();
          return;
        }
        setStatus("ready");
        setDetail("Watching the camera");
        frame = requestAnimationFrame(loop);
      } catch (error) {
        if (stopped) return;
        setStatus("error");
        setDetail(error instanceof Error ? error.message : "Face model failed to load");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      landmarker?.close();
    };
  }, [enabled, videoRef]);

  const visibleStatus: FaceStatus = enabled
    ? status === "idle" ? "loading" : status
    : "idle";
  return {
    status: visibleStatus,
    detail: enabled ? status === "idle" ? "Loading face model..." : detail : "Face monitor is off",
  };
}
