/**
 * Server-side decision rules.
 * Changing these values changes the warn/terminate thresholds globally.
 */
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

};
