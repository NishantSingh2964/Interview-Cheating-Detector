"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import type { VoiceActivityStatus } from "@/hooks/useVoiceActivity";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  voiceActivityStatus: VoiceActivityStatus;
  speaking: boolean;
  mirrored?: boolean;
}

export function CameraView({ videoRef, stream, voiceActivityStatus, speaking, mirrored = true }: Props) {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Camera frame */}
      <div className="camera-wrap" style={{ border: "2px solid var(--border)" }}>
        {stream ? (
          <>
            <video
              ref={videoRef}
              id="proctor-video"
              muted
              playsInline
              style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
            />
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
            <span className="badge badge-ok">
              <span className="pulse-dot ok" />
              Camera active
            </span>
          </div>
        )}
      </div>

      <p aria-live="polite" style={{ margin: 0, fontSize: "11px", color: voiceActivityStatus === "unavailable" ? "var(--terminate)" : speaking ? "var(--ok)" : "var(--text-muted)" }}>
        {voiceActivityStatus === "loading" && "Loading speech detection…"}
        {voiceActivityStatus === "ready" && (speaking ? "Speech detected" : "Speech detection active")}
        {voiceActivityStatus === "unavailable" && "Speech detection unavailable"}
      </p>

    </div>
  );
}
