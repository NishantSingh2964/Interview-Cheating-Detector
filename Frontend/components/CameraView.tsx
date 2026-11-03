"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { DetectionBox } from "@/lib/types";
import type { FaceStatus } from "@/hooks/useFaceMonitor";
import type { ObjectDetectStatus } from "@/hooks/useObjectDetect";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  faceCount: number;
  faceStatus: FaceStatus;
  objectStatus: ObjectDetectStatus;
  soundLevel: number;       // 0–1 RMS
  boxes: DetectionBox[];    // YOLO bounding boxes
  mirrored?: boolean;
}

const STATUS_LABEL: Record<FaceStatus, string> = {
  idle: "Camera off",
  loading: "Loading model…",
  ready: "Camera active",
  error: "Model error",
};

export function CameraView({ videoRef, stream, faceCount, faceStatus, objectStatus, soundLevel, boxes, mirrored = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Attach stream to video */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (stream) {
      v.srcObject = stream;
      v.play().catch(() => {});
    } else {
      v.srcObject = null;
    }
  }, [stream, videoRef]);

  /* Draw bounding boxes on canvas */
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!boxes.length) return;

    const W = canvas.width;
    const H = canvas.height;

    for (const box of boxes) {
      const x = box.x * W;
      const y = box.y * H;
      const w = box.width * W;
      const h = box.height * H;
      const isPhone = box.label === "cell phone";
      const color = isPhone ? "#ef4444" : "#f59e0b";

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Label background
      ctx.fillStyle = color;
      const label = `${box.label} ${Math.round(box.score * 100)}%`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillRect(x, y - 22, tw, 20);
      ctx.fillStyle = "#000";
      ctx.font = "bold 12px monospace";
      ctx.fillText(label, x + 5, y - 7);
    }
  }, [boxes, videoRef]);

  const faceOk = faceStatus === "ready" && faceCount === 1;
  const faceWarn = faceStatus === "ready" && faceCount !== 1;
  const soundPct = Math.min(100, soundLevel * 600); // amplify for display

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Camera frame */}
      <div className="camera-wrap" style={{ border: `2px solid ${faceWarn ? "var(--warn)" : faceOk ? "var(--ok)" : "var(--border)"}`, transition: "border-color 0.3s ease" }}>
        {stream ? (
          <>
            <video
              ref={videoRef}
              id="proctor-video"
              muted
              playsInline
              style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
            />
            <canvas ref={canvasRef} width={640} height={480} />
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: "13px" }}>Camera not started</span>
          </div>
        )}

        {/* Top-left status badge */}
        {stream && (
          <div style={{ position: "absolute", top: "10px", left: "10px" }}>
            <span className={`badge ${faceWarn ? "badge-warn" : faceOk ? "badge-ok" : "badge-muted"}`}>
              <span className={`pulse-dot ${faceWarn ? "warn" : faceOk ? "ok" : "accent"}`} />
              {faceStatus === "loading" ? "Loading…" : faceCount === 0 ? "No face" : faceCount === 1 ? "1 face" : `${faceCount} faces`}
            </span>
          </div>
        )}

        {/* Top-right: camera status */}
        <div style={{ position: "absolute", top: "10px", right: "10px" }}>
          <span className="badge badge-muted" style={{ fontSize: "11px" }}>
            {STATUS_LABEL[faceStatus]}
          </span>
        </div>
      </div>

      <p aria-live="polite" style={{ margin: 0, fontSize: "11px", color: objectStatus === "unavailable" ? "var(--terminate)" : "var(--text-muted)" }}>
        {objectStatus === "loading" && "Loading object detection…"}
        {objectStatus === "ready" && "Object detection active"}
        {objectStatus === "unavailable" && "Object detection unavailable"}
      </p>

      {/* Sound level meter */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div style={{ flex: 1, height: "6px", background: "var(--bg-elevated)", borderRadius: "99px", overflow: "hidden" }}>
          <div
            className="sound-bar"
            style={{
              width: `${soundPct}%`,
              background: soundPct > 60 ? "var(--terminate)" : soundPct > 30 ? "var(--warn)" : "var(--ok)",
            }}
          />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", minWidth: "28px", textAlign: "right" }}>
          {Math.round(soundLevel * 100)}
        </span>
      </div>
    </div>
  );
}
