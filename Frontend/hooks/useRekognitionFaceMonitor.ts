"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { DETECT } from "@/lib/config";
import { analyzeRekognitionFrame } from "@/lib/api";
import { createSignalGate } from "@/lib/signalGate";
import type { DetectionBox, ViolationReport } from "@/lib/types";

type Emit = (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void;
export type RekognitionFaceStatus = "idle" | "checking" | "ready" | "error";

const FRAME_INTERVAL_MS = 5000;
const PHONE_LIKE_ASPECT_RATIO = 0.8;

function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error("The camera frame is not ready."));
  }
  const scale = Math.min(1, 960 / video.videoWidth, 720 / video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Could not prepare a camera frame."));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode a camera frame."));
    }, "image/jpeg", 0.82);
  });
}

function correctPhoneLikeLaptopLabels(
  objects: DetectionBox[],
  frameWidth: number,
  frameHeight: number,
): DetectionBox[] {
  if (!frameWidth || !frameHeight) return objects;

  return objects.map((object) => {
    if (object.label !== "laptop" || object.width <= 0 || object.height <= 0) return object;
    // Rekognition can label an upright phone as a laptop; use source-pixel proportions.
    const aspectRatio = (object.width * frameWidth) / (object.height * frameHeight);
    return aspectRatio < PHONE_LIKE_ASPECT_RATIO
      ? { ...object, label: "cell phone" }
      : object;
  });
}

export function useRekognitionFaceMonitor(
  videoRef: RefObject<HTMLVideoElement | null>,
  sessionId: string,
  enabled: boolean,
  onViolation: Emit,
  onFailure: (message: string) => void,
) {
  const onViolationRef = useRef(onViolation);
  const onFailureRef = useRef(onFailure);
  const [status, setStatus] = useState<RekognitionFaceStatus>("idle");
  const [faceCount, setFaceCount] = useState<number | null>(null);
  const [objects, setObjects] = useState<DetectionBox[]>([]);
  const [detail, setDetail] = useState("");

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    onFailureRef.current = onFailure;
  }, [onFailure]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const noFace = createSignalGate(DETECT.noFaceMs, DETECT.cooldownMs);
    const multipleFaces = createSignalGate(DETECT.multipleFacesMs, DETECT.cooldownMs);
    const phone = createSignalGate(0, DETECT.cooldownMs);
    const otherObject = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);
    const multiplePeople = createSignalGate(DETECT.objectMs, DETECT.cooldownMs);

    const checkFrame = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        timer = setTimeout(checkFrame, 500);
        return;
      }

      try {
        const frame = await captureFrame(video);
        const result = await analyzeRekognitionFrame(sessionId, frame);
        if (stopped) return;
        const detectedObjects = correctPhoneLikeLaptopLabels(
          result.objects,
          video.videoWidth,
          video.videoHeight,
        );

        setStatus("ready");
        setFaceCount(result.faceCount);
        setObjects(detectedObjects);
        setDetail("");

        const now = Date.now();
        if (noFace.update(result.faceCount === 0, now)) {
          onViolationRef.current({
            type: "no_face",
            reason: "Amazon Rekognition did not detect a face in consecutive camera frames",
            confidence: 0.9,
          });
        }
        if (multipleFaces.update(result.faceCount >= 2, now)) {
          onViolationRef.current({
            type: "multiple_faces",
            reason: `Amazon Rekognition detected ${result.faceCount} faces in the camera frame`,
            confidence: 0.9,
          });
        }

        const phones = detectedObjects.filter(
          (object) => object.label === "cell phone" && object.score >= DETECT.phoneScore,
        );
        if (phones.length > 0 && phone.update(true, now)) {
          const bestPhone = phones.reduce((best, current) => (
            best.score > current.score ? best : current
          ));
          onViolationRef.current({
            type: "object_detected",
            reason: `Cell phone detected by Amazon Rekognition (${Math.round(bestPhone.score * 100)}%)`,
            confidence: bestPhone.score,
          });
        } else if (phones.length === 0) {
          phone.update(false, now);
        }

        const otherObjects = detectedObjects.filter(
          (object) =>
            object.label !== "cell phone" &&
            object.label !== "person" &&
            object.score >= DETECT.objectScore,
        );
        if (otherObjects.length > 0 && otherObject.update(true, now)) {
          const bestObject = otherObjects.reduce((best, current) => (
            best.score > current.score ? best : current
          ));
          onViolationRef.current({
            type: "object_detected",
            reason: `${bestObject.label} detected by Amazon Rekognition (${Math.round(bestObject.score * 100)}%)`,
            confidence: bestObject.score,
          });
        } else if (otherObjects.length === 0) {
          otherObject.update(false, now);
        }

        const people = detectedObjects.filter(
          (object) => object.label === "person" && object.score >= DETECT.personScore,
        );
        if (people.length >= 2 && multiplePeople.update(true, now)) {
          onViolationRef.current({
            type: "multiple_persons",
            reason: `${people.length} people detected by Amazon Rekognition`,
            confidence: Math.max(...people.map((person) => person.score)),
          });
        } else if (people.length < 2) {
          multiplePeople.update(false, now);
        }
        timer = setTimeout(checkFrame, FRAME_INTERVAL_MS);
      } catch (error) {
        if (stopped) return;
        setStatus("error");
        const message = error instanceof Error ? error.message : "Amazon Rekognition could not analyze the camera frame.";
        setDetail(message);
        onFailureRef.current(message);
      }
    };

    void checkFrame();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, sessionId, videoRef]);

  const visibleStatus: RekognitionFaceStatus = enabled
    ? status === "idle" ? "checking" : status
    : "idle";
  return {
    status: visibleStatus,
    faceCount: enabled ? faceCount : null,
    objects: enabled ? objects : [],
    detail: enabled && status !== "idle" ? detail : "",
  };
}
