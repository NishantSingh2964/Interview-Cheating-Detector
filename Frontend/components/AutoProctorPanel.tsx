"use client";

import type { AutoProctorStatus } from "@/hooks/useAutoProctor";

interface Props {
  status: AutoProctorStatus;
}

const STATUS_LABELS: Record<AutoProctorStatus, string> = {
  idle: "Not prepared",
  preparing: "Preparing",
  ready: "Ready to start",
  starting: "Starting",
  active: "Monitoring active",
  stopping: "Stopping",
  completed: "Monitoring complete",
};

const CONFIGURED_CHECKS = [
  "Face count",
  "Audio",
  "Tab changes",
  "Multiple screens",
];

const WEBSITE_CHECKS = [
  "Right-click blocked",
  "Copy/paste blocked",
];

export function AutoProctorPanel({ status }: Props) {
  const statusClass = status === "active"
    ? "badge-ok"
    : status === "starting" || status === "stopping" || status === "preparing"
      ? "badge-warn"
      : "badge-muted";

  return (
    <section aria-label="AutoProctor monitoring" style={{ paddingBottom: "14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700 }}>
          AutoProctor
        </h3>
        <span className={`badge ${statusClass}`} aria-live="polite">
          <span className={`pulse-dot ${status === "active" ? "ok" : "accent"}`} />
          {STATUS_LABELS[status]}
        </span>
      </div>

      <p style={{ margin: "0 0 8px", color: "var(--text-muted)", fontSize: "11px" }}>
        Configured checks
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "12px" }}>
        {CONFIGURED_CHECKS.map((check) => (
          <span key={check} className="badge badge-muted" style={{ fontSize: "10px" }}>
            {check}
          </span>
        ))}
      </div>
      <p style={{ margin: "0 0 8px", color: "var(--text-muted)", fontSize: "11px" }}>
        Website checks
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "12px" }}>
        {WEBSITE_CHECKS.map((check) => (
          <span key={check} className="badge badge-muted" style={{ fontSize: "10px" }}>
            {check}
          </span>
        ))}
      </div>
    </section>
  );
}
