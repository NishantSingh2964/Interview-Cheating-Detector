const Session = require("../models/Session");
const { SESSION_IDLE_END_MS } = require("../config/rules");

function inactiveSessionUpdate(endedAt) {
  return {
    $set: {
      status: "ended",
      endedAt,
      endReason: "heartbeat_timeout",
      voiceEnrolled: false,
    },
    $unset: {
      voiceprint: "",
      voiceConsentAt: "",
      voiceConsentVersion: "",
    },
  };
}

async function endInactiveSession(sessionId, endedAt = new Date()) {
  const inactiveBefore = new Date(endedAt.getTime() - SESSION_IDLE_END_MS);
  return Session.findOneAndUpdate(
    {
      _id: sessionId,
      status: "active",
      lastHeartbeat: { $lte: inactiveBefore },
    },
    inactiveSessionUpdate(endedAt),
    { new: true },
  );
}

async function expireInactiveSessions(now = new Date()) {
  const inactiveBefore = new Date(now.getTime() - SESSION_IDLE_END_MS);
  return Session.updateMany(
    {
      status: "active",
      lastHeartbeat: { $lte: inactiveBefore },
    },
    inactiveSessionUpdate(now),
  );
}

module.exports = { endInactiveSession, expireInactiveSessions };
