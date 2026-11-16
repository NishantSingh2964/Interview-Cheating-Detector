"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import type { VoiceActivityStatus } from "@/hooks/useVoiceActivity";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  voiceActivityStatus: VoiceActivityStatus;
  voiceEnrolled: boolean;
  voiceComparisonEnabled: boolean | null;
  speaking: boolean;
  soundLevel: number;       // 0–1 RMS
  mirrored?: boolean;
}

export function CameraView({ videoRef, stream, voiceActivityStatus, voiceEnrolled, voiceComparisonEnabled, speaking, soundLevel, mirrored = true }: Props) {
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

  const soundPct = Math.min(100, soundLevel * 600); // amplify for display

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

      {voiceEnrolled && (
        <p aria-live="polite" style={{ margin: 0, fontSize: "11px", color: voiceComparisonEnabled === false ? "var(--warn)" : "var(--text-muted)" }}>
          {voiceComparisonEnabled === null && "Checking speaker comparison…"}
          {voiceComparisonEnabled === true && "Speaker comparison active (review signal only)"}
          {voiceComparisonEnabled === false && "Speaker comparison unavailable — server needs configuration"}
        </p>
      )}

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
