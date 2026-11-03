/** Browser detection thresholds. Warn / terminate limits live on the server. */
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

export const DETECT = {
  noFaceMs: 3000,
  multipleFacesMs: 2000,
  lookingAwayMs: 2500,
  objectMs: 1600,
  soundMs: 2500,
  cooldownMs: 10000,
  soundRms: 0.09,
  objectScore: 0.45,
  phoneScore: 0.25,
  objectIou: 0.45,
  faceIntervalMs: 200,
  objectIntervalMs: 800,
};
