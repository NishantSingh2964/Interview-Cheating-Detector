export const SERVER_URL = (
  process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000"
).replace(/\/$/, "");

export const HEARTBEAT_MS = 5000;

/** Must stay aligned with server/src/config/rules.js once that file exists. */
export const SERVER_RULES = {
  warnAt: 3,
  terminateAt: 5,
  heartbeatMs: HEARTBEAT_MS,
  heartbeatTimeoutMs: 15000,
};

