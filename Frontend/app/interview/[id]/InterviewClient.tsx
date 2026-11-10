"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeAnswer, endSession, enrollVoice, getSession, getQuestions, saveInterviewPreferences, transcribeAnswer } from "@/lib/api";
import { FALLBACK_QUESTIONS } from "@/lib/questions";
import { HEARTBEAT_MS } from "@/lib/config";
import { VIOLATION_LABELS } from "@/lib/labels";
import type { AnalysisResult, CandidateAnswerMode, Decision, Question, Violation, ViolationReport } from "@/lib/types";

import { useFaceMonitor } from "@/hooks/useFaceMonitor";
import { useVoiceActivity } from "@/hooks/useVoiceActivity";
import { useWindowMonitor } from "@/hooks/useWindowMonitor";
import { useSoundMonitor } from "@/hooks/useSoundMonitor";
import { useObjectDetect } from "@/hooks/useObjectDetect";
import { useProctorSocket } from "@/hooks/useProctorSocket";

import { CameraView } from "@/components/CameraView";
import { QuestionPanel } from "@/components/QuestionPanel";
import { ViolationLog } from "@/components/ViolationLog";

type Stage = "setup" | "enrollment" | "enrolling" | "permission" | "active" | "terminated" | "ended" | "error";
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
const VOICE_ENROLLMENT_PROMPTS = [
  "I am ready to begin my interview and will answer each question in my own words.",
  "I am speaking at a comfortable pace and using my normal speaking voice.",
  "A clear voice sample helps the interview system recognize my voice during this session.",
];
const MIN_VOICE_CLIP_SAMPLES = 16000 * 3;
const MAX_LIVE_VOICE_CLIP_SAMPLES = 16000 * 15;
const ANSWER_REVIEW_CONSENT_VERSION = "answer-ai-likeness-v2";

function violationKey(type: string, reason: string, time: string) {
  return `${type}|${reason}|${new Date(time).getTime()}`;
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
  const [violationToasts, setViolationToasts] = useState<ViolationToast[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [warnBanner, setWarnBanner] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("Candidate");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceClips, setVoiceClips] = useState<Float32Array[]>([]);
  const [voiceEnrolled, setVoiceEnrolled] = useState(false);
  const [voiceComparisonEnabled, setVoiceComparisonEnabled] = useState<boolean | null>(null);
  const [voiceEnrollmentError, setVoiceEnrollmentError] = useState<string | null>(null);
  const [voiceEnrollmentSaving, setVoiceEnrollmentSaving] = useState(false);
  const [answerConsent, setAnswerConsent] = useState(false);
  const [candidateMode, setCandidateMode] = useState<CandidateAnswerMode | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [answerStates, setAnswerStates] = useState<Record<number, AnswerState>>({});

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRecordingRef = useRef<ActiveRecording | null>(null);
  const pendingServerViolationKeysRef = useRef(new Set<string>());
  const answerQueueRequestRef = useRef(false);
  const nextLocalViolationIdRef = useRef(0);
  const nextToastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const active = stage === "active";

  const addViolationToast = useCallback((message: string) => {
    const id = ++nextToastIdRef.current;
    setViolationToasts((current) => [...current, { id, message }]);
    const timer = setTimeout(() => {
      setViolationToasts((current) => current.filter((toast) => toast.id !== id));
      toastTimersRef.current.delete(id);
    }, 5000);
    toastTimersRef.current.set(id, timer);
  }, []);

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

  // ── Load questions + session name ────────────────────────────
  useEffect(() => {
    getQuestions().then(setQuestions).catch(() => setQuestions(FALLBACK_QUESTIONS));
    let cancelled = false;
    getSession(sessionId)
      .then(({ session }) => {
        if (cancelled) return;
        setCandidateName(session.candidateName);
        setVoiceEnrolled(session.voiceEnrolled);
        setCandidateMode(session.answerMode ?? null);
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
          setStage(session.answerMode === "speaking" && !session.voiceEnrolled ? "enrollment" : "permission");
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
      pendingServerViolationKeysRef.current.add(violationKey(report.type, report.reason, report.time));
      addViolationToast(`${VIOLATION_LABELS[report.type]}: ${report.reason}`);
      const sent = reportRef.current?.(report) ?? false;
      console.info("[proctor] violation recorded", {
        type: report.type,
        reason: report.reason,
        delivery: sent ? "submitted to server" : "local only (server disconnected)",
      });
      setLocalViolations((prev) => [
        ...prev,
        {
          _id: `local-${Date.now()}-${++nextLocalViolationIdRef.current}`,
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
    [addViolationToast, sessionId, questionIdx],
  );

  // ── Socket ───────────────────────────────────────────────────
  const handleServerViolation = useCallback((violation: Violation) => {
    const key = violationKey(violation.type, violation.reason, violation.time);
    if (pendingServerViolationKeysRef.current.delete(key)) return;
    addViolationToast(`${VIOLATION_LABELS[violation.type]}: ${violation.reason}`);
    setLocalViolations((current) => [...current, violation]);
  }, [addViolationToast]);

  const handleDecision = useCallback((d: Decision) => {
    setDecision(d);
    if (d.action === "terminate") {
      cancelAnswerRecording();
      stopCamera();
      setStage("terminated");
    } else if (d.action === "warn") {
      setWarnBanner(d.message);
      setTimeout(() => setWarnBanner(null), 7000);
    }
  }, [cancelAnswerRecording, stopCamera]);

  const handleSessionClosed = useCallback((status: "terminated" | "ended") => {
    cancelAnswerRecording();
    stopCamera();
    setStage(status);
  }, [cancelAnswerRecording, stopCamera]);

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
      setStage(candidateMode === "speaking" && !voiceEnrolled ? "enrollment" : "permission");
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : "Could not save your interview preferences.");
    } finally {
      setPreferencesSaving(false);
    }
  }, [answerConsent, candidateMode, preferencesSaving, sessionId, voiceEnrolled]);

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
    cancelAnswerRecording();
    stopCamera();
    setStage("ended");
    setEnding(true);
    setEndError(null);
    try {
      await endSession(sessionId);
    } catch (error) {
      setEndError(error instanceof Error ? error.message : "Could not save the interview end status.");
    } finally {
      setEnding(false);
    }
  }, [cancelAnswerRecording, sessionId, stopCamera]);

  const submitInterview = useCallback(async () => {
    const queued = await queueAnswerForQuestion(questionIdx + 1);
    if (queued) await endInterview();
  }, [endInterview, queueAnswerForQuestion, questionIdx]);

  const captureEnrollmentClip = useCallback((samples: Float32Array) => {
    if (samples.length < MIN_VOICE_CLIP_SAMPLES) return;
    setVoiceClips((current) => (
      current.length >= VOICE_ENROLLMENT_PROMPTS.length
        ? current
        : [...current, Float32Array.from(samples)]
    ));
  }, []);

  const startVoiceEnrollment = useCallback(async () => {
    if (candidateMode !== "speaking" || !voiceConsent) return;
    setVoiceEnrollmentError(null);
    setVoiceClips([]);
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = audioStream;
      setStream(audioStream);
      setStage("enrolling");
    } catch (error) {
      setVoiceEnrollmentError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access and try again."
          : "Could not access the microphone for voice enrollment.",
      );
    }
  }, [candidateMode, voiceConsent]);

  const submitVoiceEnrollment = useCallback(async () => {
    if (candidateMode !== "speaking" || !voiceConsent || voiceClips.length !== VOICE_ENROLLMENT_PROMPTS.length) return;
    setVoiceEnrollmentSaving(true);
    setVoiceEnrollmentError(null);
    try {
      await enrollVoice(sessionId, voiceClips);
      setVoiceEnrolled(true);
      setVoiceClips([]);
      setVoiceConsent(false);
      stopCamera();
      setStage("permission");
    } catch (error) {
      setVoiceEnrollmentError(
        error instanceof Error ? error.message : "Could not create the voice reference.",
      );
    } finally {
      setVoiceEnrollmentSaving(false);
    }
  }, [candidateMode, sessionId, stopCamera, voiceClips, voiceConsent]);

  const { connected, reportViolation, sendHeartbeat, sendQuestionChanged, sendVoiceSegment } = useProctorSocket({
    role: "candidate",
    sessionId,
    enabled: active,
    onDecision: handleDecision,
    onViolationAdded: handleServerViolation,
    onVoiceDetectionStatus: setVoiceComparisonEnabled,
    onVoiceSegmentRejected: (reason) => console.warn("[voice-monitor] server rejected speech segment:", reason),
    onRejected: (reason) => console.warn("[proctor] server rejected violation:", reason),
    onSessionClosed: handleSessionClosed,
  });

  useEffect(() => { reportRef.current = reportViolation; }, [reportViolation]);

  const reportLiveVoiceSegment = useCallback((samples: Float32Array) => {
    if (!voiceEnrolled || voiceComparisonEnabled !== true) return;
    for (let offset = 0; offset + MIN_VOICE_CLIP_SAMPLES <= samples.length; offset += MAX_LIVE_VOICE_CLIP_SAMPLES) {
      const end = Math.min(offset + MAX_LIVE_VOICE_CLIP_SAMPLES, samples.length);
      if (end - offset < MIN_VOICE_CLIP_SAMPLES) continue;
      const sent = sendVoiceSegment(sessionId, samples.slice(offset, end));
      if (!sent) console.warn("[voice-monitor] speech segment was not sent because the server is disconnected.");
    }
  }, [sendVoiceSegment, sessionId, voiceComparisonEnabled, voiceEnrolled]);

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
  const voiceModeEnabled = candidateMode === "speaking";
  const { status: voiceActivityStatus, speaking } = useVoiceActivity(
    stream,
    voiceModeEnabled && (active || stage === "enrolling"),
    voiceModeEnabled && stage === "enrolling"
      ? captureEnrollmentClip
      : voiceModeEnabled && active && voiceEnrolled ? reportLiveVoiceSegment : undefined,
  );
  const { status: objectStatus, boxes } = useObjectDetect(videoRef, active, emit);

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

  // ── Camera permission ────────────────────────────────────────
  const requestCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = s;
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

  const total = localViolations.filter((violation) => violation.type !== "other_voice").length;
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

  if (candidateMode === "speaking" && (stage === "enrollment" || stage === "enrolling")) {
    const promptIndex = Math.min(voiceClips.length, VOICE_ENROLLMENT_PROMPTS.length - 1);
    const clipsReady = voiceClips.length === VOICE_ENROLLMENT_PROMPTS.length;

    return (
      <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="glass" style={{ maxWidth: "540px", width: "100%", padding: "40px" }}>
          <div style={{ fontSize: "42px", textAlign: "center", marginBottom: "16px" }}>🎙️</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", textAlign: "center", margin: "0 0 12px" }}>
            Voice enrollment
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.65 }}>
            With your permission, three short speech samples are used to create a temporary voice reference for this interview.
            The samples are processed to create the reference and are not saved as recordings. The reference is deleted when
            the interview ends. Voice matching is an imperfect signal and should not be treated as proof of identity.
          </p>

          {voiceEnrollmentError && (
            <div role="alert" style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--terminate-bg)", color: "var(--terminate)", fontSize: "13px", marginBottom: "16px" }}>
              {voiceEnrollmentError}
            </div>
          )}

          {stage === "enrollment" ? (
            <>
              <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5, margin: "20px 0" }}>
                <input
                  type="checkbox"
                  checked={voiceConsent}
                  onChange={(event) => setVoiceConsent(event.target.checked)}
                  style={{ marginTop: "3px" }}
                />
                <span>I agree to create a session-only voice reference as described above.</span>
              </label>
              <button
                className="btn btn-primary btn-lg"
                disabled={!voiceConsent}
                onClick={() => { void startVoiceEnrollment(); }}
                style={{ width: "100%", marginBottom: "10px" }}
              >
                Start voice enrollment
              </button>
            </>
          ) : (
            <>
              <div className="glass" style={{ padding: "18px", margin: "20px 0" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>
                  Sample {Math.min(voiceClips.length + 1, VOICE_ENROLLMENT_PROMPTS.length)} of {VOICE_ENROLLMENT_PROMPTS.length}
                </div>
                <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.6 }}>
                  {clipsReady ? "All three speech samples captured." : VOICE_ENROLLMENT_PROMPTS[promptIndex]}
                </p>
                <p aria-live="polite" style={{ margin: "10px 0 0", color: speaking ? "var(--ok)" : "var(--text-muted)", fontSize: "12px" }}>
                  {speaking ? "Speech detected — finish the sentence, then pause." : `${voiceClips.length} of 3 samples captured. Each needs about 3 seconds of speech.`}
                </p>
              </div>
              {voiceActivityStatus === "loading" && (
                <p role="status" style={{ color: "var(--text-muted)", fontSize: "13px" }}>Starting speech detection…</p>
              )}
              {voiceActivityStatus === "unavailable" && (
                <p role="alert" style={{ color: "var(--terminate)", fontSize: "13px" }}>Speech detection could not start. Return and try again.</p>
              )}
              <button
                className="btn btn-primary btn-lg"
                disabled={!clipsReady || voiceEnrollmentSaving || voiceActivityStatus !== "ready"}
                onClick={() => { void submitVoiceEnrollment(); }}
                style={{ width: "100%", marginBottom: "10px" }}
              >
                {voiceEnrollmentSaving ? "Creating voice reference…" : "Save voice reference"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={voiceEnrollmentSaving}
                onClick={() => {
                  setVoiceClips([]);
                  setVoiceEnrollmentError(null);
                }}
                style={{ width: "100%", marginBottom: "10px" }}
              >
                Retake samples
              </button>
            </>
          )}

          <button
            className="btn btn-ghost"
            disabled={voiceEnrollmentSaving}
            onClick={() => {
              stopCamera();
              setVoiceClips([]);
              setVoiceConsent(false);
              setVoiceEnrollmentError(null);
              setStage("permission");
            }}
            style={{ width: "100%" }}
          >
            Skip voice enrollment
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
              ["speaking", "🎙️", "Speaking mode", "Enroll a session-only voice reference, then speak each answer."],
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
        <div className="glass" style={{ maxWidth: "480px", width: "100%", padding: "40px", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "20px" }}>🎥</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 12px" }}>
            Camera &amp; Microphone Required
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.65, margin: "0 0 28px" }}>
            This interview uses AI-assisted proctoring. Your camera and microphone must
            be enabled throughout the session. The camera checks for visible faces and
            objects such as phones in real time. No video is recorded; detection signals
            are logged.
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
            <button className="btn btn-ghost" onClick={() => router.replace("/")} style={{ width: "100%" }}>
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
        <div className="glass" style={{ maxWidth: "440px", width: "100%", padding: "44px", textAlign: "center" }}>
          <div style={{ fontSize: "56px", marginBottom: "20px" }}>{stage === "terminated" ? "🚫" : "✅"}</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "24px", marginBottom: "12px", color: stage === "terminated" ? "var(--terminate)" : "var(--ok)" }}>
            {stage === "terminated" ? "Interview Terminated" : "Interview Submitted"}
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6, margin: "0 0 16px" }}>
            {stage === "terminated"
              ? decision?.message ?? "The server has ended this session due to repeated violations."
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
      <main style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr 280px", gap: "20px", padding: "24px", alignItems: "start" }}>
        {/* Left — camera */}
        <div>
          <CameraView
            videoRef={videoRef}
            stream={stream}
            faceCount={faceCount}
            faceStatus={faceStatus}
            objectStatus={objectStatus}
            voiceActivityStatus={voiceActivityStatus}
            voiceEnrolled={voiceModeEnabled && voiceEnrolled}
            voiceComparisonEnabled={voiceComparisonEnabled}
            speaking={speaking}
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

        {/* Right — violations */}
        <div className="glass" style={{ padding: "16px", maxHeight: "calc(100vh - 140px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ViolationLog violations={localViolations} totalCount={total} />
        </div>
      </main>
    </div>
  );
}
