import { SERVER_URL } from "@/lib/config";
import type { AnalysisResult, Question, Session, Violation } from "@/lib/types";

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
  return request<{ session: Session; violations: Violation[] }>(`/api/sessions/${id}`);
}

export function endSession(id: string) {
  return request<{ session: Session }>(`/api/sessions/${id}/end`, {
    method: "POST",
  });
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

export function analyzeAnswer(input: { sessionId: string; question: number; answer: string }) {
  return request<AnalysisResult>("/api/analysis", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
