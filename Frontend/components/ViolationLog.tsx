"use client";

import type { Violation } from "@/lib/types";
import { VIOLATION_LABELS } from "@/lib/labels";

interface Props {
  violations: Violation[];
  totalCount: number;
}

const AMBER_TYPES = new Set(["window", "fullscreen", "copy", "paste", "contextmenu", "sound", "other_voice"]);

const TYPE_ICONS: Partial<Record<string, string>> = {
  no_face: "👤",
  multiple_faces: "👥",
  looking_away: "👀",
  object_detected: "📱",
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

function timeago(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ViolationLog({ violations, totalCount }: Props) {
  const reversed = [...violations].reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 14px" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700 }}>
          Violations
        </h3>
        <span
          className={`badge ${totalCount === 0 ? "badge-ok" : totalCount >= 5 ? "badge-error" : totalCount >= 3 ? "badge-warn" : "badge-muted"}`}
          style={{ fontFamily: "var(--font-mono)", minWidth: "24px", justifyContent: "center" }}
        >
          {totalCount}
        </span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "2px" }}>
        {reversed.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "28px", marginBottom: "12px" }}>✅</div>
            <p style={{ margin: 0, fontSize: "13px" }}>No violations yet</p>
          </div>
        ) : (
          reversed.map((v, i) => {
            const amber = AMBER_TYPES.has(v.type);
            return (
              <div
                key={v._id || `${v.type}-${i}`}
                className={`violation-chip ${amber ? "amber" : ""}`}
              >
                <span style={{ fontSize: "16px", lineHeight: 1, marginTop: "2px", flexShrink: 0 }}>
                  {TYPE_ICONS[v.type] ?? "🚨"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", marginBottom: "3px" }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", color: amber ? "var(--warn)" : "var(--terminate)" }}>
                      {VIOLATION_LABELS[v.type] ?? v.type}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", flexShrink: 0 }}>
                      {timeago(v.time)}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }} className="truncate">
                    {v.reason}
                  </p>
                  {v.question > 0 && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                      Q{v.question} · {Math.round(v.confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
