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
