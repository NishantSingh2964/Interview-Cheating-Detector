/**
 * Server-side decision rules.
 * Changing these values changes the warn/terminate thresholds globally.
 */
module.exports = {
  /** Total violations before the server sends a "warn" decision. */
  WARN_AT: 3,

  /** Total violations before the server terminates the session. */
  TERMINATE_AT: 5,

  /** How often the client should send a heartbeat (ms). */
  HEARTBEAT_EVERY_MS: 5000,

  /** If no heartbeat arrives within this window, log a heartbeat_lost violation (ms). */
  HEARTBEAT_TIMEOUT_MS: 15000,
};
