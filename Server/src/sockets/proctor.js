const Session = require("../models/Session");
const { processViolation } = require("../services/violationService");
const { HEARTBEAT_TIMEOUT_MS } = require("../config/rules");

/** sessionId → nodeJS timer ID (for heartbeat monitoring) */
const heartbeatTimers = new Map();

/**
 * Register all Socket.IO event handlers.
 * @param {import("socket.io").Server} io
 */
function registerProctorSocket(io) {
  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── Candidate joins ─────────────────────────────────────
    socket.on("join", async ({ sessionId }) => {
      if (!sessionId) return;
      try {
        const session = await Session.findById(sessionId).select("status");
        if (!session || session.status !== "active") {
          socket.emit("session_closed", {
            status: session?.status === "terminated" ? "terminated" : "ended",
          });
          return;
        }

        socket.join(`session:${sessionId}`);
        socket.data.sessionId = sessionId;
        socket.data.role = "candidate";
        console.log(`[socket] candidate ${socket.id} joined session ${sessionId}`);

        resetHeartbeatTimer(io, sessionId);
      } catch (err) {
        console.error("[socket] candidate join error:", err);
        socket.emit("session_unavailable", { message: "Could not verify session status." });
      }
    });

    // ── Admin joins ──────────────────────────────────────────
    socket.on("join_admin", () => {
      socket.join("admins");
      socket.data.role = "admin";
      console.log(`[socket] admin ${socket.id} joined`);
    });

    // ── Violation report ─────────────────────────────────────
    socket.on("violation", async (payload) => {
      try {
        const result = await processViolation(payload);

        if (result.rejected) {
          socket.emit("violation_rejected", { reason: result.reason });
          return;
        }

        // Send decision back to the candidate's session room
        io.to(`session:${payload.sessionId}`).emit("decision", result.decision);

        // Broadcast to admin dashboard
        io.to("admins").emit("violation_added", result.violation);

        console.log(
          `[socket] violation: ${result.violation.type} | session ${payload.sessionId} | count ${result.decision.count} | ${result.decision.action}`
        );
      } catch (err) {
        console.error("[socket] violation handler error:", err);
        socket.emit("violation_rejected", { reason: "Server error processing violation" });
      }
    });

    // ── Heartbeat ────────────────────────────────────────────
    socket.on("heartbeat", async ({ sessionId }) => {
      if (!sessionId) return;
      try {
        const session = await Session.findOneAndUpdate(
          { _id: sessionId, status: "active" },
          { lastHeartbeat: new Date() },
        );
        if (session) resetHeartbeatTimer(io, sessionId);
      } catch (err) {
        console.error("[socket] heartbeat update error:", err);
      }
    });

    // ── Question changed ─────────────────────────────────────
    socket.on("question_changed", async ({ sessionId, question }) => {
      if (!sessionId) return;
      try {
        await Session.findOneAndUpdate(
          { _id: sessionId, status: "active" },
          { currentQuestion: question },
        );
      } catch (err) {
        console.error("[socket] question_changed error:", err);
      }
    });

    // ── Disconnect ───────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });
}

/**
 * Reset (or start) the heartbeat timer for a session.
 * If no heartbeat arrives within HEARTBEAT_TIMEOUT_MS, a heartbeat_lost
 * violation is generated automatically.
 */
function resetHeartbeatTimer(io, sessionId) {
  // Clear existing timer
  if (heartbeatTimers.has(sessionId)) {
    clearTimeout(heartbeatTimers.get(sessionId));
  }

  const timer = setTimeout(async () => {
    try {
      const session = await Session.findById(sessionId);
      if (!session || session.status !== "active") return;

      console.log(`[heartbeat] lost for session ${sessionId}`);

      const result = await processViolation({
        sessionId,
        question: session.currentQuestion,
        type: "heartbeat_lost",
        reason: "No heartbeat received within the timeout window",
        confidence: 1,
        time: new Date().toISOString(),
      });

      if (!result.rejected) {
        io.to(`session:${sessionId}`).emit("decision", result.decision);
        io.to("admins").emit("violation_added", result.violation);
      }
    } catch (err) {
      console.error("[heartbeat] timer error:", err);
    }
  }, HEARTBEAT_TIMEOUT_MS);

  heartbeatTimers.set(sessionId, timer);
}

module.exports = registerProctorSocket;
