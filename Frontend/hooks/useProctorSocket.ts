"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SERVER_URL } from "@/lib/config";
import type { Decision, Violation, ViolationReport } from "@/lib/types";

/**
 * Socket contract implemented by the Express server:
 * - candidate emits `join` { sessionId }, `violation`, `heartbeat`, `question_changed`
 * - admin emits `join_admin`
 * - server emits `decision` to the candidate and `violation_added` to the admin
 * - optional `violation_rejected` { reason } when the server drops an event
 * This hook only transports events. It never chooses warn or terminate.
 */
type Options = {
  role: "candidate" | "admin";
  sessionId?: string | null;
  enabled: boolean;
  onDecision?: (decision: Decision) => void;
  onViolationAdded?: (violation: Violation) => void;
  onRejected?: (reason: string) => void;
  onSessionClosed?: (status: "terminated" | "ended") => void;
};

export function useProctorSocket({
  role,
  sessionId,
  enabled,
  onDecision,
  onViolationAdded,
  onRejected,
  onSessionClosed,
}: Options) {
  const handlers = useRef({ onDecision, onViolationAdded, onRejected, onSessionClosed, role, sessionId });
  useEffect(() => {
    handlers.current = { onDecision, onViolationAdded, onRejected, onSessionClosed, role, sessionId };
  }, [onDecision, onViolationAdded, onRejected, onSessionClosed, role, sessionId]);

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    const join = () => {
      if (handlers.current.role === "admin") {
        socket.emit("join_admin");
        return;
      }
      const id = handlers.current.sessionId;
      if (id) socket.emit("join", { sessionId: id });
    };

    socket.on("connect", () => {
      setConnected(true);
      join();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("decision", (decision: Decision) => {
      handlers.current.onDecision?.(decision);
    });
    socket.on("violation_added", (violation: Violation) => {
      handlers.current.onViolationAdded?.(violation);
    });
    socket.on("violation_rejected", (payload: { reason?: string }) => {
      handlers.current.onRejected?.(payload?.reason || "The server rejected an event.");
    });
    socket.on("session_closed", (payload: { status?: "terminated" | "ended" }) => {
      handlers.current.onSessionClosed?.(payload?.status === "terminated" ? "terminated" : "ended");
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [enabled, role, sessionId]);

  const reportViolation = useCallback((payload: ViolationReport) => {
    const socket = socketRef.current;
    if (!socket?.connected) return false;
    socket.emit("violation", payload);
    return true;
  }, []);

  const sendHeartbeat = useCallback((id: string) => {
    socketRef.current?.emit("heartbeat", { sessionId: id });
  }, []);

  const sendQuestionChanged = useCallback((id: string, question: number) => {
    socketRef.current?.emit("question_changed", { sessionId: id, question });
  }, []);

  return { connected, reportViolation, sendHeartbeat, sendQuestionChanged };
}
