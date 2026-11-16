import { SERVER_URL } from "@/lib/config";
import type { AnalysisResult, CandidateAnswerMode, DetectionBox, Question, Session, Violation } from "@/lib/types";

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message || body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError("The interview server is not reachable.");
  }
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

export function createSession(candidateName: string) {
  return request<Session>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ candidateName }),
  });
}

export function listSessions() {
  return request<Session[]>("/api/sessions");
}

export function getSession(id: string) {
  return request<SessionDetails>(`/api/sessions/${id}`);
}

export function endSession(id: string, reason?: "proctoring_unavailable") {
  return request<{ session: Session }>(`/api/sessions/${id}/end`, {
    method: "POST",
    ...(reason ? { body: JSON.stringify({ reason }) } : {}),
  });
}

export function saveInterviewPreferences(id: string, input: {
  answerMode: CandidateAnswerMode;
  answerReviewConsent: boolean;
}) {
  return request<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}/preferences`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getRekognitionStatus() {
  return request<{ enabled: boolean }>("/api/analysis/rekognition/status");
}

export function saveRekognitionConsent(id: string, consent: boolean) {
  return request<{ consent: boolean }>(`/api/sessions/${encodeURIComponent(id)}/rekognition-consent`, {
    method: "POST",
    body: JSON.stringify({ consent }),
  });
}

export function verifyRekognitionReady(id: string) {
  return request<{ ready: boolean }>("/api/analysis/rekognition/ready", {
    method: "POST",
    headers: { "X-Rekognition-Consent": "rekognition-proctoring-v1" },
    body: JSON.stringify({ sessionId: id }),
  });
}

export async function analyzeRekognitionFrame(id: string, frame: Blob) {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    response = await fetch(
      `${SERVER_URL}/api/analysis/rekognition/${encodeURIComponent(id)}/frame`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "X-Rekognition-Consent": "rekognition-proctoring-v1",
        },
        body: frame,
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Amazon Rekognition request timed out.");
    }
    throw new ApiError("The interview server is not reachable.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as { faceCount: number; objects: DetectionBox[] };
}

export async function enrollVoice(id: string, clips: Float32Array[]) {
  const clipLengths = clips.map((clip) => clip.length);
  const totalSamples = clipLengths.reduce((sum, length) => sum + length, 0);
  const combined = new Float32Array(totalSamples);
  let offset = 0;
  for (const clip of clips) {
    combined.set(clip, offset);
    offset += clip.length;
  }

  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}/api/sessions/${id}/enroll-voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Voice-Consent": "session-voiceprint-v1",
        "X-Voice-Clip-Lengths": clipLengths.join(","),
      },
      body: combined.buffer,
    });
  } catch {
    throw new ApiError("The interview server is not reachable.");
  }
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as { voiceEnrolled: boolean };
}

export async function getQuestions() {
  const data = await request<Question[] | { questions: Question[] }>("/api/questions");
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.questions)) return data.questions;
  throw new ApiError("The question list from the server was not usable.");
}

export async function transcribeAnswer(input: {
  sessionId: string;
  question: number;
  audio: Blob;
}) {
  console.debug('[API] transcribeAnswer audio size', (input.audio as Blob).size);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `${SERVER_URL}/api/analysis/transcribe?sessionId=${encodeURIComponent(input.sessionId)}&question=${input.question}`,
      {
        method: "POST",
        headers: {
          "Content-Type": input.audio.type.split(";")[0],
          "X-Answer-Review-Consent": "answer-ai-likeness-v2",
        },
        body: input.audio,
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new ApiError(await readError(response), response.status);
    return (await response.json()) as { transcript: string };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Transcription request timed out after 30 seconds.");
    }
    throw new ApiError("The interview server is not reachable.");
  } finally {
    clearTimeout(timeout);
  }
}

export function analyzeAnswer(input: {
  sessionId: string;
  question: number;
  prompt: string;
  answer: string;
  answerSource: "typed" | "spoken";
  pasteDetected: boolean;
}) {
  return request<{ answerAnalysis: AnalysisResult }>("/api/analysis", {
    method: "POST",
    headers: { "X-Answer-Review-Consent": "answer-ai-likeness-v2" },
    body: JSON.stringify(input),
  });
}

export function retryAnswerAnalysis(id: string) {
  return request<{ answerAnalysis: AnalysisResult }>(`/api/analysis/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
}

export interface SessionDetails {
  session: Session;
  violations: Violation[];
  answerAnalyses: AnalysisResult[];
}
