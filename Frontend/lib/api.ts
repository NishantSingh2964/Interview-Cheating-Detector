import { SERVER_URL } from "@/lib/config";
import { AUTOPROCTOR_CONSENT_VERSION, type AutoProctorCredentials } from "@/lib/autoProctor";
import type { AnalysisResult, AutoProctorEvent, CandidateAnswerMode, Question, Session, Violation } from "@/lib/types";

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

export function endSession(id: string) {
  return request<{ session: Session }>(`/api/sessions/${id}/end`, {
    method: "POST",
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

export function getAutoProctorCredentials(id: string) {
  return request<AutoProctorCredentials>(`/api/autoproctor/sessions/${encodeURIComponent(id)}/credentials`, {
    method: "POST",
    body: JSON.stringify({
      consent: true,
      consentVersion: AUTOPROCTOR_CONSENT_VERSION,
    }),
  });
}

export function reportAutoProctorEvent(id: string, evidenceCode: number) {
  return request<{ event: AutoProctorEvent }>(`/api/autoproctor/sessions/${encodeURIComponent(id)}/events`, {
    method: "POST",
    body: JSON.stringify({ evidenceCode }),
  });
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
  autoProctorEvents: AutoProctorEvent[];
}
