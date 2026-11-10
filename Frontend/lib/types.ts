export const VIOLATION_TYPES = [
  "no_face",
  "multiple_faces",
  "looking_away",
  "object_detected",
  "multiple_persons",
  "window",
  "fullscreen",
  "copy",
  "paste",
  "contextmenu",
  "sound",
  "heartbeat_lost",
  "other_voice",
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number];

export type DecisionAction = "ok" | "warn" | "terminate";

export type SessionStatus = "active" | "terminated" | "ended";
export type SessionEndReason = "submitted" | "heartbeat_timeout" | "violation_limit";
export type CandidateAnswerMode = "writing" | "speaking";

export interface Question {
  id: number;
  prompt: string;
  hint?: string;
}

export interface Session {
  _id: string;
  candidateName: string;
  status: SessionStatus;
  endReason?: SessionEndReason | null;
  currentQuestion: number;
  violationCount: number;
  answerMode?: CandidateAnswerMode | null;
  answerReviewConsentAt?: string | null;
  answerReviewConsentVersion?: string | null;
  voiceEnrolled: boolean;
  startedAt: string;
  endedAt: string | null;
  lastHeartbeat: string | null;
}

export interface Violation {
  _id?: string;
  sessionId: string;
  question: number;
  type: ViolationType;
  reason: string;
  confidence: number;
  time: string;
}

/** Payload the browser sends. The server stores it and decides what happens. */
export interface ViolationReport {
  sessionId: string;
  question: number;
  type: ViolationType;
  reason: string;
  confidence: number;
  time: string;
}

export interface Decision {
  action: DecisionAction;
  count: number;
  message: string;
}

export interface AnalysisResult {
  _id: string;
  question: number;
  prompt: string;
  answer: string;
  answerSource: "typed" | "spoken";
  pasteDetected: boolean;
  aiLikelihoodScore: number | null;
  aiLikelihoodBand: "low" | "inconclusive" | "high" | "not_scored";
  processingStatus: "queued" | "processing" | "completed" | "failed" | "not_scored";
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  analyzedAt: string;
}

export interface DetectionBox {
  label: string;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReportedEvent extends ViolationReport {
  delivery: "sent" | "offline";
}
