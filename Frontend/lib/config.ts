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
  // Face thresholds
  noFaceMs: 3000,
  multipleFacesMs: 3000,          // longer to avoid transient spikes
  lookingAwayMs: 2500,
  // New face‑filter constants
  minFaceConfidence: 0.6,         // faces below this are ignored
  minFaceAreaPct: 0.04,           // ignore faces covering < 4 % of frame
  multipleFacesConfirmFrames: 2, // need 2 consecutive detections

  // Object detection thresholds
  objectMs: 1600,
  soundMs: 2500,
  cooldownMs: 10000,
  soundRms: 0.12,                 // lower to cut ambient noise
  objectScore: 0.55,              // overall object confidence
  phoneScore: 0.2,               // phone confidence (lowered for more logs)
  phoneConfirmFrames: 2,          // phone must be seen 2 frames in‑a‑row (quicker detection)
  objectConfirmFrames: 3,         // generic objects need 3 consecutive frames
  personScore: 0.55,
  personConfirmFrames: 2,                // tighter duplicate‑filter
  faceIntervalMs: 200,
  objectIntervalMs: 400,
};

