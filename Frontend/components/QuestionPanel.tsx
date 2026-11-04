"use client";

import type { Question } from "@/lib/types";

interface Props {
  questions: Question[];
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onSubmit: () => void;
  disabled?: boolean;
}

export function QuestionPanel({ questions, currentIndex, onNext, onPrev, onSubmit, disabled }: Props) {
  const question = questions[currentIndex];
  const total = questions.length;
  const isLastQuestion = currentIndex === total - 1;
  const progress = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;

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

      {/* Navigation */}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
        <button
          id="prev-question-btn"
          className="btn btn-ghost"
          onClick={onPrev}
          disabled={currentIndex === 0 || disabled}
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
          onClick={isLastQuestion ? onSubmit : onNext}
          disabled={disabled}
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
