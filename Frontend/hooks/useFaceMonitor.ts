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
  onViolationRef.current = onViolation;
  const [status, setStatus] = useState<FaceStatus>("idle");
  const [faceCount, setFaceCount] = useState(0);
  const [detail, setDetail] = useState("Face monitor is off");

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setFaceCount(0);
      setDetail("Face monitor is off");
      return;
    }

    let stopped = false;
    let frame = 0;
    let lastRun = 0;
    let landmarker: { close: () => void; detectForVideo: (video: HTMLVideoElement, ts: number) => { faceLandmarks: Landmark[][] } } | null = null;

  // Helper: compute normalized face area (0‑1)
  function faceAreaPct(landmarks: Landmark[]) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of landmarks) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return (maxX - minX) * (maxY - minY);
  }

  // Streak counter for confirming multiple‑faces
  let multipleFacesStreak = 0;

    const noFace = createSignalGate(DETECT.noFaceMs, DETECT.cooldownMs);
    const multiple = createSignalGate(DETECT.multipleFacesMs, DETECT.cooldownMs);
    const away = createSignalGate(DETECT.lookingAwayMs, DETECT.cooldownMs);
    const startedAt = performance.now();

    setStatus("loading");
    setDetail("Loading face model…");

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

      setFaceCount(faces.length);
      const warmedUp = now - startedAt > 1000;
      const stamp = Date.now();

      if (warmedUp && noFace.update(faces.length === 0, stamp)) {
        onViolationRef.current({
          type: "no_face",
          reason: "No face in frame",
          confidence: 0.9,
        });
      }
      if (multiple.update(faces.length >= 2, stamp)) {
        onViolationRef.current({
          type: "multiple_faces",
          reason: `${faces.length} faces in frame`,
          confidence: 0.9,
        });
      }
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
            numFaces: 4,
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

  return { status, faceCount, detail };
}
