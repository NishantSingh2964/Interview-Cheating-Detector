"use client";

import { useCallback, useEffect, useState } from "react";
import { listSessions, getSession } from "@/lib/api";
import { useProctorSocket } from "@/hooks/useProctorSocket";
import { VIOLATION_LABELS } from "@/lib/labels";
import type { Session, Violation } from "@/lib/types";

type SessionStatus = Session["status"];

const STATUS_CLASS: Record<SessionStatus, string> = {
  active: "badge-ok",
  terminated: "badge-error",
  ended: "badge-muted",
};
const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Active",
  terminated: "Terminated",
  ended: "Ended",
};

function getSessionStatusLabel(session: Session) {
  if (session.status === "ended" && session.endReason === "heartbeat_timeout") {
    return "Ended · Connection lost";
  }
  return STATUS_LABEL[session.status];
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const TYPE_ICONS: Record<string, string> = {
  no_face: "👤", multiple_faces: "👥", looking_away: "👀",
  object_detected: "📱", multiple_persons: "🧑‍🤝‍🧑",
  window: "🪟", fullscreen: "⛶", copy: "📋", paste: "📌",
  contextmenu: "🖱", sound: "🔊", heartbeat_lost: "💔", other_voice: "🎙️",
};
const AMBER_TYPES = new Set(["window", "fullscreen", "copy", "paste", "contextmenu", "sound", "other_voice"]);

export default function AdminPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [liveViolations, setLiveViolations] = useState<(Violation & { sessionName?: string })[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Violation[]>([]);
  const [loadingExpanded, setLoadingExpanded] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  // Poll sessions every 5s
  const fetchSessions = useCallback(() => {
    listSessions()
      .then((s) => { setSessions(s); setServerErr(null); })
      .catch((err) => setServerErr(err instanceof Error ? err.message : "Server unreachable"));
  }, []);

  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 5000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  // Admin socket — live violation feed
  const handleViolationAdded = useCallback((v: Violation) => {
    const session = sessions.find((s) => s._id === v.sessionId);
    setLiveViolations((prev) => [
      { ...v, sessionName: session?.candidateName },
      ...prev.slice(0, 49),
    ]);
    // Update local violation count for the session
    if (v.type !== "other_voice") {
      setSessions((prev) =>
        prev.map((s) => s._id === v.sessionId ? { ...s, violationCount: s.violationCount + 1 } : s)
      );
    }
  }, [sessions]);

  const { connected } = useProctorSocket({
    role: "admin",
    enabled: true,
    onViolationAdded: handleViolationAdded,
  });

  // Expand session to see violations
  const toggleExpand = useCallback(async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setExpandedViolations([]);
      return;
    }
    setExpanded(id);
    setLoadingExpanded(true);
    try {
      const { violations } = await getSession(id);
      setExpandedViolations(violations);
    } catch {
      setExpandedViolations([]);
    } finally {
      setLoadingExpanded(false);
    }
  }, [expanded]);

  const activeSessions = sessions.filter((s) => s.status === "active");
  const otherSessions = sessions.filter((s) => s.status !== "active");

  return (
    <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)", background: "var(--header-bg)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 800, margin: 0 }}>
            <span className="gradient-text">Proctor Dashboard</span>
          </h1>
          <div className="divider" style={{ width: "1px", height: "20px" }} />
          <span className={`badge ${connected ? "badge-ok" : "badge-error"}`}>
            <span className={`pulse-dot ${connected ? "ok" : "terminate"}`} />
            {connected ? "Socket live" : "Socket offline"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span className="badge badge-ok">{activeSessions.length} active</span>
          <span className="badge badge-muted">{sessions.length} total</span>
          <button id="refresh-btn" className="btn btn-ghost btn-sm" onClick={fetchSessions}>
            ↺ Refresh
          </button>
          <a href="/" className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>← Start</a>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", gap: "0", alignItems: "start" }}>
        {/* Sessions list */}
        <main style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {serverErr && (
            <div style={{ padding: "14px 18px", borderRadius: "var(--radius-md)", background: "var(--terminate-bg)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--terminate)", display: "flex", gap: "10px", alignItems: "center" }}>
              <span>⚠</span>
              <div>
                <strong style={{ fontSize: "14px" }}>Server unreachable</strong>
                <p style={{ margin: "2px 0 0", fontSize: "12px", opacity: 0.8 }}>{serverErr}</p>
              </div>
            </div>
          )}

          {/* Active */}
          {activeSessions.length > 0 && (
            <section>
              <h2 style={{ margin: "0 0 12px", fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ok)" }}>
                🟢 Active — {activeSessions.length}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {activeSessions.map((s) => (
                  <SessionCard key={s._id} session={s} isExpanded={expanded === s._id} expandedViolations={expanded === s._id ? expandedViolations : []} loading={loadingExpanded && expanded === s._id} onToggle={() => toggleExpand(s._id)} />
                ))}
              </div>
            </section>
          )}

          {/* Past */}
          {otherSessions.length > 0 && (
            <section>
              <h2 style={{ margin: "0 0 12px", fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
                Past Sessions — {otherSessions.length}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {otherSessions.map((s) => (
                  <SessionCard key={s._id} session={s} isExpanded={expanded === s._id} expandedViolations={expanded === s._id ? expandedViolations : []} loading={loadingExpanded && expanded === s._id} onToggle={() => toggleExpand(s._id)} />
                ))}
              </div>
            </section>
          )}

          {sessions.length === 0 && !serverErr && (
            <div className="glass" style={{ padding: "60px 24px", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "36px", marginBottom: "16px" }}>📋</div>
              <p style={{ margin: 0, fontSize: "15px" }}>No sessions yet. Start an interview from the home page.</p>
            </div>
          )}
        </main>

        {/* Live feed sidebar */}
        <aside style={{ borderLeft: "1px solid var(--border)", padding: "24px", minHeight: "calc(100vh - 65px)", position: "sticky", top: "65px", overflowY: "auto", maxHeight: "calc(100vh - 65px)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Live Events</h3>
            <span className="badge badge-muted" style={{ fontFamily: "var(--font-mono)" }}>{liveViolations.length}</span>
          </div>
          <p style={{ margin: "-8px 0 14px", color: "var(--text-muted)", fontSize: "11px", lineHeight: 1.5 }}>
            Voice-difference events are review signals only; they do not count toward the violation total.
          </p>

          {liveViolations.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 12px", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>✅</div>
              <p style={{ margin: 0, fontSize: "13px" }}>No live events</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {liveViolations.map((v, i) => {
                const amber = AMBER_TYPES.has(v.type);
                return (
                  <div key={`${v._id}-${i}`} className={`violation-chip ${amber ? "amber" : ""}`}>
                    <span style={{ fontSize: "15px", flexShrink: 0 }}>{TYPE_ICONS[v.type] ?? "🚨"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "2px" }}>
                        <span style={{ fontWeight: 600, fontSize: "12px", color: amber ? "var(--warn)" : "var(--terminate)" }}>
                          {VIOLATION_LABELS[v.type] ?? v.type}
                        </span>
                        {v.type === "other_voice" && (
                          <span className="badge badge-warn" style={{ fontSize: "9px", padding: "2px 5px" }}>REVIEW ONLY</span>
                        )}
                      </div>
                      {v.sessionName && (
                        <span style={{ fontSize: "11px", color: "var(--accent-1)" }}>{v.sessionName}</span>
                      )}
                      <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--text-muted)" }} className="truncate">{v.reason}</p>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>{formatTime(v.time)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── SessionCard sub-component ─────────────────────────────── */
function SessionCard({ session, isExpanded, expandedViolations, loading, onToggle }: {
  session: Session;
  isExpanded: boolean;
  expandedViolations: Violation[];
  loading: boolean;
  onToggle: () => void;
}) {
  const pct = Math.min(100, (session.violationCount / 5) * 100);
  const statusClass = STATUS_CLASS[session.status];
  const amber = AMBER_TYPES;

  return (
    <div className="glass" style={{ padding: "18px 20px", cursor: "pointer", transition: "all 0.2s ease" }}
      onClick={onToggle}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isExpanded ? "12px" : "0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span style={{ fontSize: "16px" }}>
            {session.status === "active" ? "🟢" : session.status === "terminated" ? "🔴" : "⚪"}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "15px" }} className="truncate">{session.candidateName}</div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {session._id.slice(-8)} · Q{session.currentQuestion} · {timeAgo(session.startedAt)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span className={`badge ${statusClass}`}>{getSessionStatusLabel(session)}</span>
          <span className={`badge ${session.violationCount === 0 ? "badge-ok" : session.violationCount >= 5 ? "badge-error" : session.violationCount >= 3 ? "badge-warn" : "badge-muted"}`}>
            {session.violationCount} 🚨
          </span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            style={{ color: "var(--text-muted)", transform: isExpanded ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}
          >
            <path d="M19 9l-7 7-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Violation progress bar */}
      {!isExpanded && (
        <div style={{ marginTop: "10px" }}>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{
              width: `${pct}%`,
              background: session.violationCount >= 5 ? "var(--terminate)" : session.violationCount >= 3 ? "var(--warn)" : "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
            }} />
          </div>
        </div>
      )}

      {/* Expanded violation list */}
      {isExpanded && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: "8px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
              <div className="spinner" />
            </div>
          ) : expandedViolations.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0, textAlign: "center", padding: "20px" }}>No events recorded.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "280px", overflowY: "auto" }}>
              {expandedViolations.map((v, i) => (
                <div key={v._id ?? i} className={`violation-chip ${amber.has(v.type) ? "amber" : ""}`}>
                  <span style={{ fontSize: "14px", flexShrink: 0 }}>{TYPE_ICONS[v.type] ?? "🚨"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
                      <span style={{ fontWeight: 600, fontSize: "12px", color: amber.has(v.type) ? "var(--warn)" : "var(--terminate)" }}>
                        {VIOLATION_LABELS[v.type] ?? v.type}
                      </span>
                      {v.type === "other_voice" && (
                        <span className="badge badge-warn" style={{ fontSize: "9px", padding: "2px 5px" }}>REVIEW ONLY</span>
                      )}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                        Q{v.question} · {formatTime(v.time)}
                      </span>
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--text-muted)" }} className="truncate">{v.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
