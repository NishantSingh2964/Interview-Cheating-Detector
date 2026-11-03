const Session = require("../models/Session");
const Violation = require("../models/Violation");
const { WARN_AT, TERMINATE_AT } = require("../config/rules");

const VALID_TYPES = new Set([
  "no_face",
  "multiple_faces",
  "looking_away",
  "object_detected",
  "multiple_persons",
  "window",
  "fullscreen",
  "copy",
  "paste",
  "contextmenu",
  "sound",
  "heartbeat_lost",
]);

/**
 * Process an incoming violation report.
 *
 * 1. Validate type + session.
 * 2. Persist the violation.
 * 3. Increment the session's count.
 * 4. Return a decision: ok | warn | terminate.
 *
 * @param {Object} payload  — { sessionId, question, type, reason, confidence, time }
 * @returns {{ violation, decision, session }}
 */
async function processViolation(payload) {
  const { sessionId, question, type, reason, confidence, time } = payload;

  // ── Validate type ───────────────────────────────────────────
  if (!VALID_TYPES.has(type)) {
    return { rejected: true, reason: `Unknown violation type: ${type}` };
  }

  // ── Find session ────────────────────────────────────────────
  const session = await Session.findById(sessionId);
  if (!session) {
    return { rejected: true, reason: "Session not found" };
  }
  if (session.status !== "active") {
    return { rejected: true, reason: "Session is no longer active" };
  }

  // ── Save violation ──────────────────────────────────────────
  const violation = await Violation.create({
    sessionId,
    question: question || session.currentQuestion,
    type,
    reason: reason || type,
    confidence: confidence ?? 1,
    time: time ? new Date(time) : new Date(),
  });

  // ── Update session count ────────────────────────────────────
  session.violationCount += 1;
  const count = session.violationCount;

  // ── Decide ──────────────────────────────────────────────────
  let action = "ok";
  let message = "";

  if (count >= TERMINATE_AT) {
    action = "terminate";
    message = `Session terminated — ${count} violations reached the limit.`;
    session.status = "terminated";
    session.endedAt = new Date();
  } else if (count >= WARN_AT) {
    action = "warn";
    message = `Warning: you have ${count} violations. At ${TERMINATE_AT} the session ends.`;
  }

  await session.save();

  return {
    rejected: false,
    violation: violation.toObject(),
    decision: { action, count, message },
    session: session.toObject(),
  };
}

module.exports = { processViolation };
