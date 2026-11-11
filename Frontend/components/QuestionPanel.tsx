"use client";

import type { AnalysisResult, CandidateAnswerMode, Question } from "@/lib/types";

type AnswerStatus = "idle" | "recording" | "transcribing" | "ready" | "analyzing" | "queued" | "error";
interface AnswerState {
  status: AnswerStatus;
  transcript: string;
  analysis: AnalysisResult | null;
  error: string | null;
}

interface Props {
  questions: Question[];
  currentIndex: number;
  answerMode: CandidateAnswerMode;
  answerConsent: boolean;
  answerState: AnswerState;
  onTranscriptChange: (transcript: string) => void;
  onAnswerPaste: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onNext: () => void | Promise<void>;
  onPrev: () => void;
  onSubmit: () => void | Promise<void>;
  disabled?: boolean;
}

export function QuestionPanel({
  questions,
  currentIndex,
  answerMode,
  answerConsent,
  answerState,
  onTranscriptChange,
  onAnswerPaste,
  onStartRecording,
  onStopRecording,
  onNext,
  onPrev,
  onSubmit,
  disabled,
}: Props) {
  const question = questions[currentIndex];
  const total = questions.length;
  const isLastQuestion = currentIndex === total - 1;
  const progress = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
  const answerBusy = answerState.status === "recording" || answerState.status === "transcribing" || answerState.status === "analyzing";

  if (!question) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", height: "100%" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Question {currentIndex + 1} of {total}
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          <span className="badge badge-accent">Q{question.id}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Question prompt */}
      <div
        className="glass"
        style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: "16px", minHeight: "160px" }}
      >
        <p
          style={{
            fontSize: "clamp(15px, 2vw, 18px)",
            fontWeight: 500,
            lineHeight: 1.65,
            color: "var(--text-primary)",
            margin: 0,
            flex: 1,
          }}
        >
          {question.prompt}
        </p>

        {question.hint && (
          <>
            <div className="divider" />
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "14px", marginTop: "1px" }}>💡</span>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
                {question.hint}
              </p>
            </div>
          </>
        )}
      </div>

      <section className="glass" aria-label="Candidate answer" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <h3 style={{ margin: "0 0 6px", fontSize: "14px" }}>
            Your {answerMode === "writing" ? "written" : "spoken"} answer
          </h3>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "11px", lineHeight: 1.5 }}>
            {answerMode === "writing"
              ? "Type your answer below. Clicking Next saves it and queues an experimental AI-likeness estimate if you opted in at the start."
              : "Record your answer and review its Whisper transcript before clicking Next. With your opt-in, the transcript is saved and queued for an experimental AI-likeness estimate."}
          </p>
        </div>
        {answerMode === "writing" ? (
          <>
            <label htmlFor="answer-transcript" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Type your answer
            </label>
            <textarea
              id="answer-transcript"
              className="input"
              rows={5}
              maxLength={20000}
              value={answerState.transcript}
              onChange={(event) => onTranscriptChange(event.target.value)}
              onPaste={onAnswerPaste}
              disabled={answerBusy || disabled}
              placeholder="Write your answer here."
              style={{ resize: "vertical", fontSize: "12px", lineHeight: 1.5 }}
            />
            <p style={{ margin: "-6px 0 0", color: "var(--text-muted)", fontSize: "10px" }}>
              {answerState.transcript.length} / 20,000 characters
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "11px", lineHeight: 1.5 }}>
              Your recording is sent to the configured Whisper service for transcription. The audio is not saved.
            </p>
            {answerState.status === "recording" ? (
              <button className="btn btn-ghost" onClick={onStopRecording} disabled={disabled}>
                Stop recording
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={onStartRecording} disabled={!answerConsent || answerBusy || disabled}>
                {answerState.status === "transcribing" ? "Transcribing…" : "Record spoken answer"}
              </button>
            )}
            {answerState.transcript && (
              <>
                <label htmlFor="answer-transcript" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Review transcript
                </label>
                <textarea
                  id="answer-transcript"
                  className="input"
                  rows={5}
                  value={answerState.transcript}
                  readOnly
                  style={{ resize: "vertical", fontSize: "12px", lineHeight: 1.5 }}
                />
              </>
            )}
          </>
        )}
        {answerState.status === "queued" && (
          <p role="status" style={{ margin: 0, color: "var(--ok)", fontSize: "11px" }}>
            {answerState.analysis?.processingStatus === "not_scored"
              ? "Answer saved. It is under 40 words, so no estimate was generated."
              : "Answer saved. Its estimate will be processed in the background."}
          </p>
        )}
        {answerState.transcript.trim() && !answerConsent && (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "11px" }}>
            You did not opt in to AI review, so this answer will not be sent or saved.
          </p>
        )}
        {answerState.error && (
          <p role="alert" style={{ margin: 0, color: "var(--terminate)", fontSize: "12px" }}>{answerState.error}</p>
        )}
      </section>

      {/* Navigation */}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
        <button
          id="prev-question-btn"
          className="btn btn-ghost"
          onClick={onPrev}
          disabled={currentIndex === 0 || disabled || answerBusy}
          aria-label="Previous question"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Previous
        </button>
        <button
          id="next-question-btn"
          className="btn btn-primary"
          onClick={isLastQuestion ? () => { void onSubmit(); } : () => { void onNext(); }}
          disabled={disabled || answerBusy}
          aria-label={isLastQuestion ? "Submit interview" : "Next question"}
        >
          {isLastQuestion ? "Submit interview" : "Next"}
          {!isLastQuestion && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
