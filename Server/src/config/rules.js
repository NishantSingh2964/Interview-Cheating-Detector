/**
 * Server-side decision rules.
 * Changing these values changes the warn/terminate thresholds globally.
 */
const voiceThresholdValue = process.env.VOICE_OTHER_THRESHOLD;
const voiceThreshold = voiceThresholdValue?.trim() ? Number(voiceThresholdValue) : null;

if (voiceThreshold !== null && (!Number.isFinite(voiceThreshold) || voiceThreshold < -1 || voiceThreshold > 1)) {
  throw new Error("VOICE_OTHER_THRESHOLD must be a cosine similarity from -1 to 1.");
}

module.exports = {
  /** Total violations before the server sends a "warn" decision. */
  WARN_AT: 3,

  /** Temporarily disable automatic termination during testing. */
  TERMINATION_ENABLED: false,

  /** Total violations before the server terminates the session. */
  TERMINATE_AT: 5,

  /** How often the client should send a heartbeat (ms). */
  HEARTBEAT_EVERY_MS: 5000,

  /** End an abandoned active session after this much heartbeat inactivity (ms). */
  SESSION_IDLE_END_MS: 60000,

  /** Leave unset until a threshold has been calibrated for the deployed model and microphones. */
  VOICE_OTHER_THRESHOLD: voiceThreshold,
  VOICE_WINDOW_SIZE: 3,
  VOICE_REQUIRED_LOW_SCORES: 2,
  VOICE_COOLDOWN_MS: 10000,
};
