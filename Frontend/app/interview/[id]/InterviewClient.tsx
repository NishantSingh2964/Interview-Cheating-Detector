"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, getQuestions } from "@/lib/api";
import { FALLBACK_QUESTIONS } from "@/lib/questions";
import { HEARTBEAT_MS } from "@/lib/config";
import type { Decision, Question, Violation, ViolationReport } from "@/lib/types";

import { useFaceMonitor } from "@/hooks/useFaceMonitor";
import { useWindowMonitor } from "@/hooks/useWindowMonitor";
import { useSoundMonitor } from "@/hooks/useSoundMonitor";
import { useObjectDetect } from "@/hooks/useObjectDetect";
import { useProctorSocket } from "@/hooks/useProctorSocket";

import { CameraView } from "@/components/CameraView";
import { QuestionPanel } from "@/components/QuestionPanel";
import { ViolationLog } from "@/components/ViolationLog";

type Stage = "permission" | "active" | "terminated";

interface Props {
  sessionId: string;
}

export function InterviewClient({ sessionId }: Props) {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("permission");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [localViolations, setLocalViolations] = useState<Violation[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [warnBanner, setWarnBanner] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("Candidate");

  const videoRef = useRef<HTMLVideoElement>(null);
  const active = stage === "active";

  // ── Load questions + session name ────────────────────────────
  useEffect(() => {
    getQuestions().then(setQuestions).catch(() => setQuestions(FALLBACK_QUESTIONS));
    if (sessionId) {
      getSession(sessionId)
        .then(({ session }) => setCandidateName(session.candidateName))
        .catch(() => {});
    }
  }, [sessionId]);

  // ── Violation emitter ────────────────────────────────────────
  const reportRef = useRef<((p: ViolationReport) => boolean) | null>(null);

  const emit = useCallback(
    (partial: Pick<ViolationReport, "type" | "reason" | "confidence">) => {
      const report: ViolationReport = {
        sessionId,
        question: questionIdx + 1,
        time: new Date().toISOString(),
        ...partial,
      };
      const sent = reportRef.current?.(report) ?? false;
      setLocalViolations((prev) => [
        ...prev,
        {
          _id: `local-${Date.now()}`,
          sessionId,
          question: report.question,
          type: report.type,
          reason: report.reason,
          confidence: report.confidence,
          time: report.time,
        } satisfies Violation,
      ]);
      if (!sent) console.warn("[proctor] offline — violation queued locally:", report.type);
    },
    [sessionId, questionIdx],
  );

  // ── Socket ───────────────────────────────────────────────────
  const handleDecision = useCallback((d: Decision) => {
    setDecision(d);
    if (d.action === "terminate") {
      setStage("terminated");
    } else if (d.action === "warn") {
      setWarnBanner(d.message);
      setTimeout(() => setWarnBanner(null), 7000);
    }
  }, []);

  const { connected, reportViolation, sendHeartbeat, sendQuestionChanged } = useProctorSocket({
    role: "candidate",
    sessionId,
    enabled: active,
    onDecision: handleDecision,
  });

  useEffect(() => { reportRef.current = reportViolation; }, [reportViolation]);

  // ── Heartbeat ────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !sessionId) return;
    const id = setInterval(() => sendHeartbeat(sessionId), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [active, sessionId, sendHeartbeat]);

  // ── Question changed ─────────────────────────────────────────
  useEffect(() => {
    if (!active || !sessionId) return;
    sendQuestionChanged(sessionId, questionIdx + 1);
  }, [questionIdx, active, sessionId, sendQuestionChanged]);

  // ── Monitors ─────────────────────────────────────────────────
  const { status: faceStatus, faceCount } = useFaceMonitor(videoRef, active, emit);
  useWindowMonitor(active, emit);
  const { level: soundLevel } = useSoundMonitor(stream, active, emit);
  const { boxes } = useObjectDetect(videoRef, active, emit);

  // ── Keyboard nav ─────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setQuestionIdx((i) => Math.min(i + 1, questions.length - 1));
      if (e.key === "ArrowLeft")  setQuestionIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, questions.length]);

  // ── Camera permission ────────────────────────────────────────
  const requestCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(s);
      setStage("active");
    } catch (err) {
      setCameraError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission was denied. Please allow access and retry."
          : "Could not access your camera or microphone.",
      );
    }
  }, []);

  const total = localViolations.length;

  /* ── Permission screen ─────────────────────────────────────── */
  if (stage === "permission") {
    return (
      <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="glass" style={{ maxWidth: "480px", width: "100%", padding: "40px", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "20px" }}>🎥</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 12px" }}>
            Camera &amp; Microphone Required
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.65, margin: "0 0 28px" }}>
            This interview uses AI-assisted proctoring. Your camera and microphone must
            be enabled throughout the session. No video is recorded — only behavioral
            signals are logged.
          </p>
          {cameraError && (
            <div style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--terminate-bg)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--terminate)", fontSize: "13px", marginBottom: "20px", textAlign: "left" }}>
              {cameraError}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <button id="allow-camera-btn" className="btn btn-primary btn-lg" onClick={requestCamera} style={{ width: "100%" }}>
              Allow Camera &amp; Start
            </button>
            <button className="btn btn-ghost" onClick={() => router.push("/")} style={{ width: "100%" }}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Terminated screen ─────────────────────────────────────── */
  if (stage === "terminated") {
    return (
      <div className="overlay overlay-terminate">
        <div className="glass" style={{ maxWidth: "440px", width: "100%", padding: "44px", textAlign: "center" }}>
          <div style={{ fontSize: "56px", marginBottom: "20px" }}>🚫</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", marginBottom: "12px", color: "var(--terminate)" }}>
            Interview Terminated
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6, margin: "0 0 16px" }}>
            {decision?.message ?? "The server has ended this session due to repeated violations."}
          </p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-muted)", marginBottom: "28px" }}>
            Total violations: <strong style={{ color: "var(--terminate)" }}>{total}</strong>
          </p>
          <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => router.push("/")}>
            Return to Start
          </button>
        </div>
      </div>
    );
  }

  /* ── Active interview ──────────────────────────────────────── */
  return (
    <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--header-bg)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px" }}>
            <span className="gradient-text">Interview Proctor</span>
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>· {candidateName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className={`badge ${connected ? "badge-ok" : "badge-muted"}`}>
            <span className={`pulse-dot ${connected ? "ok" : "accent"}`} />
            {connected ? "Live" : "Offline"}
          </span>
          <span className={`badge ${total === 0 ? "badge-ok" : total >= 5 ? "badge-error" : total >= 3 ? "badge-warn" : "badge-muted"}`}>
            {total} violation{total === 1 ? "" : "s"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
            {sessionId.slice(-8)}
          </span>
        </div>
      </header>

      {/* Warning banner */}
      {warnBanner && (
        <div style={{ background: "var(--warn-bg)", borderBottom: "1px solid rgba(245,158,11,0.35)", padding: "10px 24px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span>⚠️</span>
          <span style={{ color: "var(--warn)", fontSize: "14px", fontWeight: 500 }}>{warnBanner}</span>
        </div>
      )}

      {/* 3-column layout */}
      <main style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 280px", gap: "20px", padding: "24px", alignItems: "start" }}>
        {/* Left — camera */}
        <div>
          <CameraView
            stream={stream}
            faceCount={faceCount}
            faceStatus={faceStatus}
            soundLevel={soundLevel}
            boxes={boxes}
          />
        </div>

        {/* Center — question */}
        <div style={{ minHeight: "380px", display: "flex", flexDirection: "column" }}>
          {questions.length > 0 ? (
            <QuestionPanel
              questions={questions}
              currentIndex={questionIdx}
              onNext={() => setQuestionIdx((i) => Math.min(i + 1, questions.length - 1))}
              onPrev={() => setQuestionIdx((i) => Math.max(i - 1, 0))}
            />
          ) : (
            <div className="glass" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className="spinner" />
            </div>
          )}
        </div>

        {/* Right — violations */}
        <div className="glass" style={{ padding: "16px", maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ViolationLog violations={localViolations} totalCount={total} />
        </div>
      </main>
    </div>
  );
}
