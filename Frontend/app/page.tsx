"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createSession } from "@/lib/api";

export default function StartPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      try {
        const session = await createSession(trimmed);
        router.push(`/interview/${session._id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not connect to the server."
        );
      } finally {
        setLoading(false);
      }
    },
    [name, router]
  );

  return (
    <div className="gradient-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      {/* Ambient orbs */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-15%", left: "30%", width: "600px", height: "600px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)", filter: "blur(40px)" }} />
        <div style={{ position: "absolute", bottom: "-10%", right: "20%", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)", filter: "blur(40px)" }} />
      </div>

      <div style={{ width: "100%", maxWidth: "460px", position: "relative" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          {/* Icon */}
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "72px", height: "72px", borderRadius: "20px", background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12))", border: "1px solid var(--border-strong)", marginBottom: "24px" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="url(#ig)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="ig" x1="3" y1="12" x2="21" y2="12" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 5vw, 34px)", fontWeight: 800, margin: "0 0 8px" }}>
            <span className="gradient-text">Interview Proctor</span>
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", margin: 0 }}>
            AI-assisted live monitoring for a fair interview.
          </p>
        </div>

        {/* Card */}
        <div className="glass" style={{ padding: "36px" }}>
          {/* Info strip */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "28px" }}>
            {[
              { icon: "👁", label: "Face monitor" },
              { icon: "🔊", label: "Sound monitor" },
              { icon: "🖥", label: "Tab monitor" },
            ].map((f) => (
              <span key={f.label} className="badge badge-accent" style={{ fontSize: "11px" }}>
                {f.icon} {f.label}
              </span>
            ))}
          </div>

          <form onSubmit={handleStart} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <label htmlFor="candidate-name" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Full Name
              </label>
              <input
                id="candidate-name"
                className="input"
                type="text"
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoFocus
                autoComplete="off"
                maxLength={80}
              />
            </div>

            {error && (
              <div style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--terminate-bg)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--terminate)", fontSize: "13px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <span>⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button
              id="start-interview-btn"
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={!name.trim() || loading}
              style={{ width: "100%" }}
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: "16px", height: "16px" }} />
                  Starting…
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M5 3l14 9-14 9V3z" fill="currentColor"/>
                  </svg>
                  Begin Interview
                </>
              )}
            </button>
          </form>

          <div className="divider" style={{ margin: "24px 0" }} />

          <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "12px", margin: 0, lineHeight: 1.6 }}>
            Your camera and microphone will be used for proctoring only.
            No video is recorded. Spoken-answer recording is optional and requires separate consent.
          </p>
        </div>

        {/* Admin link */}
        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <a href="/admin" style={{ color: "var(--text-muted)", fontSize: "13px", textDecoration: "none", transition: "color var(--transition)" }}
            onMouseOver={(e) => (e.currentTarget.style.color = "var(--accent-1)")}
            onMouseOut={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            Interviewer dashboard →
          </a>
        </div>
      </div>
    </div>
  );
}
