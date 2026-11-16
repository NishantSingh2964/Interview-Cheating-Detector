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
  soundMs: 2500,
  cooldownMs: 10000,
  soundRms: 0.12,                 // lower to cut ambient noise
  voiceOtherThreshold: 0.25, // tighter detection of other voices               // similarity below this → other_voice violation
  voiceCandidateThreshold: 0.7, // stricter for positive candidate detection            // optional – similarity above this → candidate_voice (not used yet)
};

