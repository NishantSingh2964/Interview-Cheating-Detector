const test = require("node:test");
const assert = require("node:assert/strict");
const Session = require("../models/Session");
const { SESSION_IDLE_END_MS } = require("../config/rules");
const { endInactiveSession, expireInactiveSessions } = require("./sessionLifecycleService");

test("ends only an active session whose last heartbeat is beyond the grace period", async () => {
  const original = Session.findOneAndUpdate;
  let captured;
  Session.findOneAndUpdate = async (...args) => {
    captured = args;
    return { status: "ended" };
  };
  const endedAt = new Date("2026-11-04T12:00:00.000Z");

  try {
    const result = await endInactiveSession("session-id", endedAt);
    assert.equal(result.status, "ended");
    assert.deepEqual(captured[0], {
      _id: "session-id",
      status: "active",
      lastHeartbeat: { $lte: new Date(endedAt.getTime() - SESSION_IDLE_END_MS) },
    });
    assert.equal(captured[1].$set.endReason, "heartbeat_timeout");
    assert.equal(captured[1].$set.voiceEnrolled, false);
    assert.deepEqual(captured[1].$unset, {
      voiceprint: "",
      voiceConsentAt: "",
      voiceConsentVersion: "",
    });
    assert.deepEqual(captured[2], { new: true });
  } finally {
    Session.findOneAndUpdate = original;
  }
});

test("startup cleanup uses the same inactivity cutoff and only ends active sessions", async () => {
  const original = Session.updateMany;
  let captured;
  Session.updateMany = async (...args) => {
    captured = args;
    return { modifiedCount: 2 };
  };
  const now = new Date("2026-11-04T12:00:00.000Z");

  try {
    const result = await expireInactiveSessions(now);
    assert.equal(result.modifiedCount, 2);
    assert.deepEqual(captured[0], {
      status: "active",
      lastHeartbeat: { $lte: new Date(now.getTime() - SESSION_IDLE_END_MS) },
    });
    assert.equal(captured[1].$set.endReason, "heartbeat_timeout");
  } finally {
    Session.updateMany = original;
  }
});
