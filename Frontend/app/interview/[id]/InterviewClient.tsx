"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeAnswer, endSession, getSession, getQuestions, saveInterviewPreferences, transcribeAnswer } from "@/lib/api";
import { FALLBACK_QUESTIONS } from "@/lib/questions";
import { HEARTBEAT_MS } from "@/lib/config";
import { VIOLATION_LABELS } from "@/lib/labels";
import { AUTOPROCTOR_CONSENT_VERSION } from "@/lib/autoProctor";
import type { AnalysisResult, AutoProctorEvent, CandidateAnswerMode, Decision, Question, Violation, ViolationReport } from "@/lib/types";

import { useVoiceActivity } from "@/hooks/useVoiceActivity";
import { useProctorSocket } from "@/hooks/useProctorSocket";
import { useAutoProctor } from "@/hooks/useAutoProctor";
import { useWindowMonitor } from "@/hooks/useWindowMonitor";

import { CameraView } from "@/components/CameraView";
import { AutoProctorPanel } from "@/components/AutoProctorPanel";
import { QuestionPanel } from "@/components/QuestionPanel";
import { ViolationLog } from "@/components/ViolationLog";

type Stage = "setup" | "permission" | "active" | "terminated" | "ended" | "error";
type ViolationToast = { id: number; message: string };
type AnswerStatus = "idle" | "recording" | "transcribing" | "ready" | "analyzing" | "queued" | "error";
type AnswerSource = "typed" | "spoken";
interface AnswerState {
  status: AnswerStatus;
  transcript: string;
  source: AnswerSource;
  pasteDetected: boolean;
  analysis: AnalysisResult | null;
  error: string | null;
}
interface ActiveRecording {
  recorder: MediaRecorder;
  chunks: Blob[];
  question: number;
  cancelled: boolean;
}
const EMPTY_ANSWER_STATE: AnswerState = {
  status: "idle",
  transcript: "",
  source: "typed",
  pasteDetected: false,
  analysis: null,
  error: null,
};
const ANSWER_REVIEW_CONSENT_VERSION = "answer-ai-likeness-v2";

function formatViolationToast(type: Violation["type"], reason: string) {
  switch (type) {
    case "no_face":
      return `The camera lost you. It gets attached. (${reason})`;
    case "multiple_faces":
    case "multiple_persons":
      return `Unexpected guest stars! The camera spotted extra people. (${reason})`;
    case "looking_away":
      return `Your eyes went on a side quest. (${reason})`;
    case "object_detected":
      return `A surprise prop made a cameo. (${reason})`;
    case "copy":
    case "paste":
      return `Clipboard shenanigans spotted. (${reason})`;
    case "candidate_voice":
      return `Candidate voice recognized. (${reason})`;
    default:
      return `${VIOLATION_LABELS[type]}: ${reason}`;
  }
}


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
  const [autoProctorHistory, setAutoProctorHistory] = useState<AutoProctorEvent[]>([]);
  const [violationTotal, setViolationTotal] = useState(0);
  const [violationToasts, setViolationToasts] = useState<ViolationToast[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [warnBanner, setWarnBanner] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("Candidate");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [autoProctorConsent, setAutoProctorConsent] = useState(false);
  const [autoProctorPreparing, setAutoProctorPreparing] = useState(false);
  const [autoProctorStartPending, setAutoProctorStartPending] = useState(false);
  const [answerConsent, setAnswerConsent] = useState(false);
  const [candidateMode, setCandidateMode] = useState<CandidateAnswerMode | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [answerStates, setAnswerStates] = useState<Record<number, AnswerState>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRecordingRef = useRef<ActiveRecording | null>(null);
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);
  const cancelAnswerRecording = useCallback(() => {
    const recording = activeRecordingRef.current;
    if (!recording) return;
    recording.cancelled = true;
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    activeRecordingRef.current = null;
  }, []);
  const handleUnexpectedAutoProctorStop = useCallback(() => {
    cancelAnswerRecording();
    stopCamera();
    setSessionError("AutoProctor stopped monitoring unexpectedly.");
    setStage("error");
    void endSession(sessionId).catch((error) => {
      console.error("[autoproctor] could not end the session after monitoring stopped:", error);
    });
  }, [cancelAnswerRecording, sessionId, stopCamera]);
  const {
    status: autoProctorStatus,
    error: autoProctorError,
    reportError: autoProctorReportError,
    reportLoading: autoProctorReportLoading,
    signals: autoProctorSignals,
    prepare: prepareAutoProctor,
    start: startAutoProctor,
    stop: stopAutoProctor,
    showReport: showAutoProctorReport,
  } = useAutoProctor({ onUnexpectedStop: handleUnexpectedAutoProctorStop });

  const answerQueueRequestRef = useRef(false);
  const nextToastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const active = stage === "active";

  useEffect(() => {
    if ((stage === "ended" || stage === "terminated") && autoProctorStatus === "completed") {
      void showAutoProctorReport().catch((error) => {
        console.error("[autoproctor] could not display the report:", error);
      });
    }
  }, [autoProctorStatus, showAutoProctorReport, stage]);

  const addViolationToast = useCallback((message: string) => {
    const id = ++nextToastIdRef.current;
    setViolationToasts((current) => [...current, { id, message }]);
    const timer = setTimeout(() => {
      setViolationToasts((current) => current.filter((toast) => toast.id !== id));
      toastTimersRef.current.delete(id);
    }, 5000);
    toastTimersRef.current.set(id, timer);
  }, []);

  // ── Load questions + session name ────────────────────────────
  useEffect(() => {
    getQuestions().then(setQuestions).catch(() => setQuestions(FALLBACK_QUESTIONS));
    let cancelled = false;
    getSession(sessionId)
      .then(({ session, violations, autoProctorEvents }) => {
        if (cancelled) return;
        setCandidateName(session.candidateName);
        setLocalViolations(violations);
        setAutoProctorHistory(autoProctorEvents ?? []);
        setViolationTotal(session.violationCount);
        setCandidateMode(session.answerMode ?? null);
        setAutoProctorConsent(
          Boolean(
            session.autoProctorConsentAt &&
            session.autoProctorConsentVersion === AUTOPROCTOR_CONSENT_VERSION,
          ),
        );
        setAnswerConsent(
          Boolean(
            session.answerReviewConsentAt &&
            session.answerReviewConsentVersion === ANSWER_REVIEW_CONSENT_VERSION,
          ),
        );
        if (session.status === "terminated" || session.status === "ended") {
          setStage(session.status);
        } else if (!session.answerMode) {
          setStage("setup");
        } else {
          setStage("permission");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setSessionError(error instanceof Error ? error.message : "Could not verify this interview session.");
        setStage("error");
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    const recording = activeRecordingRef.current;
    if (recording) {
      recording.cancelled = true;
      if (recording.recorder.state !== "inactive") recording.recorder.stop();
    }
  }, []);

  useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
    toastTimersRef.current.clear();
  }, []);

  // ── Socket ───────────────────────────────────────────────────
  const handleServerViolation = useCallback((violation: Violation) => {
    addViolationToast(formatViolationToast(violation.type, violation.reason));
    setLocalViolations((current) => [...current, violation]);
    if (violation.type !== "other_voice") {
      setViolationTotal((current) => current + 1);
    }
  }, [addViolationToast]);

  const handleDecision = useCallback((d: Decision) => {
    setDecision(d);
    if (d.action === "terminate") {
      cancelAnswerRecording();
      void stopAutoProctor().catch((error) => console.error("[autoproctor] failed to stop after termination:", error));
      stopCamera();
      setStage("terminated");
    } else if (d.action === "warn") {
      setWarnBanner(`The proctor's keeping score (politely): ${d.message}`);
      setTimeout(() => setWarnBanner(null), 7000);
    }
  }, [cancelAnswerRecording, stopAutoProctor, stopCamera]);

  const handleSessionClosed = useCallback((status: "terminated" | "ended") => {
    cancelAnswerRecording();
    void stopAutoProctor().catch((error) => console.error("[autoproctor] failed to stop after session closure:", error));
    stopCamera();
    setStage(status);
  }, [cancelAnswerRecording, stopAutoProctor, stopCamera]);

  const updateAnswerState = useCallback((question: number, update: Partial<AnswerState>) => {
    setAnswerStates((current) => ({
      ...current,
      [question]: { ...(current[question] ?? EMPTY_ANSWER_STATE), ...update },
    }));
  }, []);

  const savePreferences = useCallback(async () => {
    if (!candidateMode || preferencesSaving) return;
    if (candidateMode === "speaking" && !answerConsent) return;
    setPreferencesSaving(true);
    setPreferencesError(null);
    try {
      await saveInterviewPreferences(sessionId, {
        answerMode: candidateMode,
        answerReviewConsent: answerConsent,
      });
      setStage("permission");
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : "Could not save your interview preferences.");
    } finally {
      setPreferencesSaving(false);
    }
  }, [answerConsent, candidateMode, preferencesSaving, sessionId]);

  const startAnswerRecording = useCallback(() => {
    if (candidateMode !== "speaking" || !answerConsent) return;
    const audioTracks = streamRef.current?.getAudioTracks() ?? [];
    if (!audioTracks.length) {
      updateAnswerState(questionIdx + 1, {
        status: "error",
        error: "Microphone is unavailable. Check microphone permission and retry.",
      });
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      updateAnswerState(questionIdx + 1, {
        status: "error",
        error: "This browser does not support audio recording. Try a current version of Chrome or Edge.",
      });
      return;
    }

    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      updateAnswerState(questionIdx + 1, {
        status: "error",
        error: "This browser does not support a compatible recording format.",
      });
      return;
    }

    try {
      const recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType });
      const recording: ActiveRecording = {
        recorder,
        chunks: [],
        question: questionIdx + 1,
        cancelled: false,
      };
      activeRecordingRef.current = recording;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recording.chunks.push(event.data);
      };
      recorder.onerror = () => {
        recording.cancelled = true;
        updateAnswerState(recording.question, {
          status: "error",
          error: "The browser could not record this answer. Please try again.",
        });
        activeRecordingRef.current = null;
      };
      recorder.onstop = async () => {
        if (activeRecordingRef.current === recording) activeRecordingRef.current = null;
        if (recording.cancelled) return;
        const audio = new Blob(recording.chunks, { type: recorder.mimeType });
        if (!audio.size) {
          updateAnswerState(recording.question, {
            status: "error",
            error: "No audio was recorded. Check your microphone and try again.",
          });
          return;
        }

        updateAnswerState(recording.question, { status: "transcribing", error: null });
        try {
          const result = await transcribeAnswer({
            sessionId,
            question: recording.question,
            audio,
          });
          updateAnswerState(recording.question, {
            status: "ready",
            transcript: result.transcript,
            source: "spoken",
            pasteDetected: false,
            analysis: null,
            error: null,
          });
        } catch (error) {
          updateAnswerState(recording.question, {
            status: "error",
            error: error instanceof Error ? error.message : "Could not transcribe this answer.",
          });
        }
      };
      recorder.start();
      updateAnswerState(recording.question, {
        status: "recording",
        transcript: "",
        source: "spoken",
        pasteDetected: false,
        analysis: null,
        error: null,
      });
    } catch (error) {
      updateAnswerState(questionIdx + 1, {
        status: "error",
        error: error instanceof Error ? error.message : "Could not start recording.",
      });
    }
  }, [answerConsent, candidateMode, questionIdx, sessionId, updateAnswerState]);

  const stopAnswerRecording = useCallback(() => {
    const recording = activeRecordingRef.current;
    if (recording && recording.recorder.state !== "inactive") recording.recorder.stop();
  }, []);

  const queueAnswerForQuestion = useCallback(async (questionNumber: number) => {
    const answerState = answerStates[questionNumber] ?? EMPTY_ANSWER_STATE;
    const prompt = questions[questionNumber - 1]?.prompt;
    if (["recording", "transcribing", "analyzing"].includes(answerState.status)) return false;
    if (answerState.status === "queued") return true;
    if (!answerConsent || !prompt || !answerState.transcript.trim()) return true;
    if (answerQueueRequestRef.current) return false;

    answerQueueRequestRef.current = true;
    updateAnswerState(questionNumber, { status: "analyzing", error: null });
    try {
      const { answerAnalysis } = await analyzeAnswer({
        sessionId,
        question: questionNumber,
        prompt,
        answer: answerState.transcript,
        answerSource: answerState.source,
        pasteDetected: answerState.pasteDetected,
      });
      updateAnswerState(questionNumber, {
        status: "queued",
        analysis: answerAnalysis,
        error: null,
      });
      return true;
    } catch (error) {
      updateAnswerState(questionNumber, {
        status: "ready",
        error: error instanceof Error ? error.message : "Could not send this answer for review.",
      });
      return false;
    } finally {
      answerQueueRequestRef.current = false;
    }
  }, [answerConsent, answerStates, questions, sessionId, updateAnswerState]);

  const advanceQuestion = useCallback(async () => {
    const queued = await queueAnswerForQuestion(questionIdx + 1);
    if (queued) setQuestionIdx((index) => Math.min(index + 1, questions.length - 1));
  }, [queueAnswerForQuestion, questionIdx, questions.length]);

  const endInterview = useCallback(async () => {
    if (ending) return;
    cancelAnswerRecording();
    setEnding(true);
    setEndError(null);
    const errors: string[] = [];
    try {
      await stopAutoProctor();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "AutoProctor did not confirm that monitoring stopped.");
    }
    stopCamera();
    setStage("ended");
    try {
      await endSession(sessionId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Could not save the interview end status.");
    } finally {
      setEnding(false);
    }
    if (errors.length) setEndError(errors.join(" "));
  }, [cancelAnswerRecording, ending, sessionId, stopAutoProctor, stopCamera]);

  const submitInterview = useCallback(async () => {
    const queued = await queueAnswerForQuestion(questionIdx + 1);
    if (queued) await endInterview();
  }, [endInterview, queueAnswerForQuestion, questionIdx]);

  const { connected, reportViolation, sendHeartbeat, sendQuestionChanged } = useProctorSocket({
    role: "candidate",
    sessionId,
    enabled: active,
    onDecision: handleDecision,
    onViolationAdded: handleServerViolation,
    onRejected: (reason) => console.warn("[proctor] server rejected violation:", reason),
    onSessionClosed: handleSessionClosed,
  });

  const reportBrowserViolation = useCallback((event: Pick<ViolationReport, "type" | "reason" | "confidence">) => {
    const sent = reportViolation({
      sessionId,
      question: questionIdx + 1,
      ...event,
      time: new Date().toISOString(),
    });
    if (!sent) console.error("[proctor] browser event could not be queued for delivery.");
    if (event.type === "paste") {
      updateAnswerState(questionIdx + 1, { pasteDetected: true });
    }
  }, [questionIdx, reportViolation, sessionId, updateAnswerState]);

  useWindowMonitor(autoProctorStatus === "ready" || active, active, reportBrowserViolation);

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
  const voiceModeEnabled = candidateMode === "speaking";
  const { status: voiceActivityStatus, speaking } = useVoiceActivity(
    stream,
    voiceModeEnabled && active,
  );

  // ── Keyboard nav ─────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (activeRecordingRef.current || ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === "ArrowRight") void advanceQuestion();
      if (e.key === "ArrowLeft")  setQuestionIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, advanceQuestion, questions.length]);

  const prepareProctoring = useCallback(async () => {
    if (!autoProctorConsent || autoProctorPreparing) return;
    setAutoProctorPreparing(true);
    setCameraError(null);
    try {
      await prepareAutoProctor(sessionId);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Could not prepare AutoProctor.");
    } finally {
      setAutoProctorPreparing(false);
    }
  }, [autoProctorConsent, autoProctorPreparing, prepareAutoProctor, sessionId]);

  const requestCamera = useCallback(async () => {
    if (autoProctorStatus !== "ready" || autoProctorStartPending) return;
    setAutoProctorStartPending(true);
    setCameraError(null);
    let cameraStream: MediaStream | null = null;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      await startAutoProctor();
      streamRef.current = cameraStream;
      setStream(cameraStream);
      setStage("active");
    } catch (err) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      const isCameraError = err instanceof DOMException;
      setCameraError(
        isCameraError && err.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera and microphone access, then try again."
          : err instanceof Error
            ? err.message
            : "Could not start AutoProctor or access your camera and microphone.",
      );
    } finally {
      setAutoProctorStartPending(false);
    }
  }, [autoProctorStartPending, autoProctorStatus, startAutoProctor]);

  const total = violationTotal;
  const activitySignals = [...autoProctorHistory, ...autoProctorSignals];
  const activityCount = total + activitySignals.length;
  const currentAnswerState = answerStates[questionIdx + 1] ?? EMPTY_ANSWER_STATE;

  if (sessionLoading) {
    return (
      <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="overlay overlay-terminate">
        <div className="glass" style={{ maxWidth: "440px", width: "100%", padding: "44px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", marginBottom: "12px" }}>Interview unavailable</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>{sessionError}</p>
          <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => router.replace("/")}>
            Return to Start
          </button>
        </div>
      </div>
    );
  }

  if (stage === "setup") {
    const canContinue = candidateMode !== null &&
      !(candidateMode === "speaking" && !answerConsent) &&
      !preferencesSaving;
    return (
      <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="glass" style={{ maxWidth: "620px", width: "100%", padding: "36px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", margin: "0 0 8px" }}>
            Choose how you&apos;ll answer
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6, margin: "0 0 20px" }}>
            Choose the response mode you want to use for this interview.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
            {([
              ["writing", "✍️", "Writing mode", "Type your response to each question."],
              ["speaking", "🎙️", "Speaking mode", "Record spoken answers for transcription after you consent."],
            ] as const).map(([mode, icon, title, description]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={candidateMode === mode}
                onClick={() => setCandidateMode(mode)}
                className="glass"
                style={{
                  padding: "18px",
                  textAlign: "left",
                  cursor: "pointer",
                  border: candidateMode === mode ? "1px solid var(--accent)" : "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                <span style={{ display: "block", fontSize: "24px", marginBottom: "8px" }}>{icon}</span>
                <strong style={{ display: "block", marginBottom: "6px" }}>{title}</strong>
                <span style={{ color: "var(--text-muted)", fontSize: "12px", lineHeight: 1.5 }}>{description}</span>
              </button>
            ))}
          </div>
          <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", color: "var(--text-secondary)", fontSize: "12px", lineHeight: 1.55, marginBottom: "12px" }}>
            <input
              type="checkbox"
              checked={answerConsent}
              onChange={(event) => setAnswerConsent(event.target.checked)}
              disabled={preferencesSaving}
              style={{ marginTop: "3px" }}
            />
            <span>
              I consent to my answer being sent to the configured AI provider for an experimental, uncalibrated AI-likeness estimate and saved for the interviewer for up to 7 days. In speaking mode, my recording will also be sent to the interview server for local transcription; the audio is not saved. This estimate cannot prove who wrote an answer.
            </span>
          </label>
          {candidateMode === "speaking" && !answerConsent && (
            <p style={{ color: "var(--warn)", fontSize: "12px", lineHeight: 1.5 }}>
              Speaking mode requires consent for local audio transcription. To continue without AI review, choose writing mode and leave consent unchecked.
            </p>
          )}
          {preferencesError && (
            <p role="alert" style={{ color: "var(--terminate)", fontSize: "13px" }}>{preferencesError}</p>
          )}
          <button
            className="btn btn-primary btn-lg"
            disabled={!canContinue}
            onClick={() => { void savePreferences(); }}
            style={{ width: "100%", marginTop: "12px" }}
          >
            {preferencesSaving ? "Saving preferences…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  /* ── Permission screen ─────────────────────────────────────── */
  if (stage === "permission") {
    return (
      <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="glass" style={{ maxWidth: "560px", width: "100%", padding: "40px" }}>
          <div style={{ fontSize: "48px", marginBottom: "20px" }}>🎥</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 12px" }}>
            AutoProctor consent and device access
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.65, margin: "0 0 16px" }}>
            AutoProctor is a third-party service that analyzes camera and microphone input for face count and sound and detects tab changes and multiple screens. This interview does not require full screen, take random photos, record the full session, or monitor auxiliary devices. This website blocks and logs right-click and copy/paste attempts. AutoProctor processes its data under its own privacy terms; automated signals are not proof of cheating.
          </p>
          <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.55, margin: "20px 0" }}>
            <input
              type="checkbox"
              checked={autoProctorConsent}
              onChange={(event) => setAutoProctorConsent(event.target.checked)}
              disabled={autoProctorPreparing || autoProctorStartPending || autoProctorStatus !== "idle"}
              style={{ marginTop: "3px" }}
            />
            <span>
              I consent to AutoProctor processing my camera and microphone input and collecting the proctoring evidence described above. I understand this website blocks and logs right-click and copy/paste attempts during the interview.
            </span>
          </label>
          {(cameraError || autoProctorError) && (
            <div role="alert" style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--terminate-bg)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--terminate)", fontSize: "13px", marginBottom: "20px", textAlign: "left" }}>
              {cameraError || autoProctorError}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {autoProctorStatus === "ready" || autoProctorStatus === "starting" ? (
              <button
                id="allow-camera-btn"
                className="btn btn-primary btn-lg"
                disabled={autoProctorStartPending || autoProctorStatus !== "ready"}
                onClick={() => { void requestCamera(); }}
                style={{ width: "100%" }}
              >
                {autoProctorStartPending ? "Starting monitoring…" : "Allow devices and start interview"}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                disabled={!autoProctorConsent || autoProctorPreparing || autoProctorStatus !== "idle"}
                onClick={() => { void prepareProctoring(); }}
                style={{ width: "100%" }}
              >
                {autoProctorPreparing ? "Preparing AutoProctor…" : "Prepare AutoProctor"}
              </button>
            )}
            <button
              className="btn btn-ghost"
              disabled={autoProctorPreparing || autoProctorStartPending}
              onClick={() => router.replace("/")}
              style={{ width: "100%" }}
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Ended and terminated screens ──────────────────────────── */
  if (stage === "terminated" || stage === "ended") {
    return (
      <div className="overlay overlay-terminate">
        <div className="glass" style={{ maxWidth: "960px", width: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", padding: "32px", textAlign: "center" }}>
          <div style={{ fontSize: "56px", marginBottom: "20px" }}>{stage === "terminated" ? "🚫" : "✅"}</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", marginBottom: "12px", color: stage === "terminated" ? "var(--terminate)" : "var(--ok)" }}>
            {stage === "terminated" ? "Interview Terminated" : "Interview Submitted"}
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6, margin: "0 0 16px" }}>
            {stage === "terminated"
              ? decision?.message ?? "The server has ended this session due to repeated violations."
            : endError
              ? "Your interview is complete. Camera and microphone access from this page has stopped, but the server could not confirm that AutoProctor monitoring stopped."
              : "Your interview is complete. Camera, microphone, and monitoring have been stopped."}
          </p>
          {stage === "ended" && endError && (
            <div role="alert" style={{ padding: "12px", marginBottom: "16px", borderRadius: "var(--radius-sm)", background: "var(--terminate-bg)", color: "var(--terminate)", fontSize: "13px" }}>
              The interview ended on this device, but the server could not be updated: {endError}
              <button className="btn btn-ghost" disabled={ending} onClick={() => { void endInterview(); }} style={{ width: "100%", marginTop: "10px" }}>
                {ending ? "Saving…" : "Retry saving end status"}
              </button>
            </div>
          )}
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-muted)", marginBottom: "28px" }}>
            Total violations: <strong style={{ color: "var(--terminate)" }}>{total}</strong>
          </p>
          <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => router.replace("/")}>
            Return to Start
          </button>
          {autoProctorStatus === "completed" && (
            <section style={{ marginTop: "28px", textAlign: "left" }}>
              <h3 style={{ margin: "0 0 12px" }}>AutoProctor report</h3>
              {autoProctorReportLoading && (
                <p role="status" style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                  Loading the AutoProctor report…
                </p>
              )}
              {autoProctorReportError && (
                <p role="alert" style={{ color: "var(--terminate)", fontSize: "13px" }}>
                  {autoProctorReportError}
                </p>
              )}
              <div id="ap-report__overview" />
              <div id="ap-report-tab-container" />
            </section>
          )}
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
          <span className="badge badge-muted" title="Formal violations plus all AutoProctor signals">
            {activityCount} events
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
            {sessionId.slice(-8)}
          </span>
        </div>
      </header>

      <div className="violation-toast-container" aria-live="polite" aria-atomic="false">
        {violationToasts.map((toast) => (
          <div className="violation-toast" key={toast.id} role="status">
            <span aria-hidden="true">⚠</span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Warning banner */}
      {warnBanner && (
        <div style={{ background: "var(--warn-bg)", borderBottom: "1px solid rgba(245,158,11,0.35)", padding: "10px 24px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span>⚠️</span>
          <span style={{ color: "var(--warn)", fontSize: "14px", fontWeight: 500 }}>{warnBanner}</span>
        </div>
      )}

      {/* 3-column layout */}
      <main id="test-container" style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 280px", gap: "20px", padding: "24px", alignItems: "start" }}>
        {/* Left — camera */}
        <div>
          <CameraView
            videoRef={videoRef}
            stream={stream}
            voiceActivityStatus={voiceActivityStatus}
            speaking={speaking}
          />
        </div>

        {/* Center — question */}
        <div style={{ minHeight: "380px", display: "flex", flexDirection: "column" }}>
          {questions.length > 0 ? (
            <QuestionPanel
              questions={questions}
              currentIndex={questionIdx}
              answerMode={candidateMode ?? "writing"}
              answerConsent={answerConsent}
              answerState={currentAnswerState}
              onTranscriptChange={(transcript) => updateAnswerState(questionIdx + 1, {
                transcript,
                source: "typed",
                status: "ready",
                analysis: null,
                error: null,
              })}
              onAnswerPaste={() => updateAnswerState(questionIdx + 1, { pasteDetected: true })}
              onStartRecording={startAnswerRecording}
              onStopRecording={stopAnswerRecording}
              onNext={() => { void advanceQuestion(); }}
              onPrev={() => setQuestionIdx((i) => Math.max(i - 1, 0))}
              onSubmit={() => { void submitInterview(); }}
              disabled={ending}
            />
          ) : (
            <div className="glass" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className="spinner" />
            </div>
          )}
        </div>

        {/* Right — monitoring signals and violations */}
        <div className="glass" style={{ padding: "16px", maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", gap: "14px", overflow: "hidden" }}>
          <AutoProctorPanel status={autoProctorStatus} />
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <ViolationLog
              violations={localViolations}
              autoProctorSignals={activitySignals}
              totalCount={total}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
