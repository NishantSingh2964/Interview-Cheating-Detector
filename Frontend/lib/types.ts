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
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number];

export type DecisionAction = "ok" | "warn" | "terminate";

export type SessionStatus = "active" | "terminated" | "ended";

export interface Question {
  id: number;
  prompt: string;
  hint?: string;
}

export interface Session {
  _id: string;
  candidateName: string;
  status: SessionStatus;
  currentQuestion: number;
  violationCount: number;
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
  aiLikelihood: number;
  note?: string;
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
