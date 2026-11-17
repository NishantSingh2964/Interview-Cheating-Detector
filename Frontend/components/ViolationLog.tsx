"use client";

import type { AutoProctorSignal } from "@/lib/autoProctor";
import type { Violation } from "@/lib/types";
import { VIOLATION_LABELS } from "@/lib/labels";

interface Props {
  violations: Violation[];
  autoProctorSignals?: AutoProctorSignal[];
  totalCount: number;
  compact?: boolean;
}

type ActivityEntry =
  | { kind: "violation"; key: string; time: string; violation: Violation }
  | { kind: "autoproctor"; key: string; time: string; signal: AutoProctorSignal };

const AMBER_TYPES = new Set(["window", "fullscreen", "copy", "paste", "contextmenu", "sound", "other_voice"]);

const TYPE_ICONS: Partial<Record<string, string>> = {
  no_face: "👤",
  multiple_faces: "👥",
  looking_away: "👀",
  object_detected: "🔎",
  multiple_persons: "🧑‍🤝‍🧑",
  window: "🪟",
  fullscreen: "⛶",
  copy: "📋",
  paste: "📌",
  contextmenu: "🖱",
  sound: "🔊",
  heartbeat_lost: "💔",
  other_voice: "🎙️",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ViolationLog({
  violations,
  autoProctorSignals = [],
  totalCount,
  compact = false,
}: Props) {
  const activityCount = totalCount + autoProctorSignals.length;
  const entries: ActivityEntry[] = [
    ...violations.map((violation, index) => ({
      kind: "violation" as const,
      key: violation._id ?? `${violation.type}-${violation.time}-${index}`,
      time: violation.time,
      violation,
    })),
    ...autoProctorSignals.map((signal, index) => ({
      kind: "autoproctor" as const,
      key: `${signal.evidenceCode}-${signal.occurredAt}-${index}`,
      time: signal.occurredAt,
      signal,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return (
    <div style={{ display: "flex", flexDirection: "column", height: compact ? undefined : "100%", gap: "0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "0 0 10px" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700 }}>
          Interview activity
        </h3>
        <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
          <span
            className="badge badge-muted"
            aria-label={`${activityCount} total activity events`}
            title="Formal violations plus all AutoProctor signals"
            style={{ fontFamily: "var(--font-mono)", minWidth: "24px", justifyContent: "center" }}
          >
            {activityCount} events
          </span>
        </div>
      </div>
      <p style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: "10px" }}>
        {totalCount} formal violations · {autoProctorSignals.length} AutoProctor signals
      </p>

      <div
        role="log"
        aria-label="Interview activity"
        aria-live="polite"
        style={{
          flex: compact ? undefined : 1,
          minHeight: 0,
          maxHeight: compact ? "220px" : undefined,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          paddingRight: "2px",
        }}
      >
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: compact ? "18px 12px" : "40px 16px", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "28px", marginBottom: "12px" }}>📋</div>
            <p style={{ margin: 0, fontSize: "13px" }}>No activity recorded yet</p>
          </div>
        ) : (
          entries.map((entry) => {
            if (entry.kind === "autoproctor") {
              return (
                <div key={entry.key} className="violation-chip amber">
                  <span aria-hidden="true" style={{ fontSize: "15px", color: "var(--warn)", flexShrink: 0 }}>◉</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", marginBottom: "3px" }}>
                      <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--warn)" }}>
                        {entry.signal.label}
                      </span>
                      <time dateTime={entry.time} style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", flexShrink: 0 }}>
                        {formatTime(entry.time)}
                      </time>
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      AutoProctor · review-only · code {entry.signal.evidenceCode}
                    </span>
                  </div>
                </div>
              );
            }

            const violation = entry.violation;
            const amber = AMBER_TYPES.has(violation.type);
            return (
              <div
                key={entry.key}
                className={`violation-chip ${amber ? "amber" : ""}`}
              >
                <span style={{ fontSize: "16px", lineHeight: 1, marginTop: "2px", flexShrink: 0 }}>
                  {TYPE_ICONS[violation.type] ?? "🚨"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", marginBottom: "3px" }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", color: amber ? "var(--warn)" : "var(--terminate)" }}>
                      {VIOLATION_LABELS[violation.type] ?? violation.type}
                    </span>
                    <time dateTime={violation.time} style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", flexShrink: 0 }}>
                      {formatTime(violation.time)}
                    </time>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }} className="truncate">
                    {violation.reason}
                  </p>
                  {violation.question > 0 && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                      Q{violation.question} · {Math.round(violation.confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {autoProctorSignals.length > 0 && (
        <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: "10px", lineHeight: 1.4 }}>
          AutoProctor signals are review-only and do not affect violation totals or enforcement.
        </p>
      )}
    </div>
  );
}
