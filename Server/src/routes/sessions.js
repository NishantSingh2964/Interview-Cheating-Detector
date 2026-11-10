const express = require("express");
const router = express.Router();
const Session = require("../models/Session");
const Violation = require("../models/Violation");
const { createVoiceprint } = require("../services/voiceService");

const VOICE_SAMPLE_RATE = 16000;
const VOICE_CLIP_COUNT = 3;
const MIN_CLIP_SAMPLES = VOICE_SAMPLE_RATE * 3;
const MAX_CLIP_SAMPLES = VOICE_SAMPLE_RATE * 15;

/**
 * POST /api/sessions
 * Create a new interview session.
 */
router.post("/", async (req, res) => {
  try {
    const { candidateName } = req.body;
    if (!candidateName || typeof candidateName !== "string" || !candidateName.trim()) {
      return res.status(400).json({ message: "candidateName is required" });
    }

    const session = await Session.create({
      candidateName: candidateName.trim(),
    });

    res.status(201).json(session);
  } catch (err) {
    console.error("[sessions] POST /", err);
    res.status(500).json({ message: "Failed to create session" });
  }
});

/**
 * GET /api/sessions
 * List all sessions (most recent first). Used by the admin dashboard.
 */
router.get("/", async (_req, res) => {
  try {
    const sessions = await Session.find().sort({ startedAt: -1 }).lean();
    res.json(sessions);
  } catch (err) {
    console.error("[sessions] GET /", err);
    res.status(500).json({ message: "Failed to list sessions" });
  }
});

/**
 * GET /api/sessions/:id
 * Get a single session with its violations.
 */
router.get("/:id", async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ message: "Session not found" });

    const violations = await Violation.find({ sessionId: session._id })
      .sort({ time: -1 })
      .lean();

    res.json({ session, violations });
  } catch (err) {
    console.error("[sessions] GET /:id", err);
    res.status(500).json({ message: "Failed to fetch session" });
  }
});

/**
 * POST /api/sessions/:id/enroll-voice
 * Build a session-only voiceprint from three speech clips; audio is never persisted.
 */
router.post(
  "/:id/enroll-voice",
  express.raw({ type: "application/octet-stream", limit: "4mb" }),
  async (req, res) => {
    try {
      if (req.get("x-voice-consent") !== "session-voiceprint-v1") {
        return res.status(400).json({ message: "Explicit voice enrollment consent is required." });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length % 4 !== 0) {
        return res.status(400).json({ message: "Voice samples must be Float32 audio data." });
      }

      const clipLengths = (req.get("x-voice-clip-lengths") || "")
        .split(",")
        .map((length) => Number(length));
      if (
        clipLengths.length !== VOICE_CLIP_COUNT ||
        clipLengths.some((length) =>
          !Number.isInteger(length) || length < MIN_CLIP_SAMPLES || length > MAX_CLIP_SAMPLES
        ) ||
        clipLengths.reduce((sum, length) => sum + length, 0) !== req.body.length / 4
      ) {
        return res.status(400).json({ message: "Provide three valid speech clips, each 3 to 15 seconds long." });
      }

      const session = await Session.findById(req.params.id);
      if (!session) return res.status(404).json({ message: "Session not found." });
      if (session.status !== "active") {
        return res.status(409).json({ message: "Voice enrollment requires an active interview session." });
      }

      let offset = 0;
      const clips = clipLengths.map((length) => {
        const samples = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          const sample = req.body.readFloatLE((offset + index) * 4);
          if (!Number.isFinite(sample) || Math.abs(sample) > 1) {
            throw new Error("Voice samples contain invalid audio values.");
          }
          samples[index] = sample;
        }
        offset += length;
        return samples;
      });

      const voiceprint = createVoiceprint(clips);
      session.set("voiceprint", voiceprint);
      session.voiceEnrolled = true;
      session.set("voiceConsentAt", new Date());
      session.set("voiceConsentVersion", "session-voiceprint-v1");
      await session.save();

      res.json({ voiceEnrolled: true });
    } catch (err) {
      if (err instanceof Error && err.message === "Voice samples contain invalid audio values.") {
        return res.status(400).json({ message: err.message });
      }
      if (err instanceof Error && err.message.includes("Speaker embedding model is missing")) {
        return res.status(503).json({ message: err.message });
      }
      console.error("[sessions] POST /:id/enroll-voice", err);
      res.status(500).json({ message: "Could not create the voice reference. Please retry enrollment." });
    }
  },
);

/**
 * POST /api/sessions/:id/end
 * Mark an active interview as ended. Repeated requests are safe.
 */
router.post("/:id/end", async (req, res) => {
  try {
    const session = await Session.findById(req.params.id)
      .select("+voiceprint +voiceConsentAt +voiceConsentVersion");
    if (!session) return res.status(404).json({ message: "Session not found" });

    if (session.status === "active") {
      session.status = "ended";
      session.endedAt = new Date();
      session.endReason = "submitted";
    }
    session.voiceEnrolled = false;
    session.set("voiceprint", undefined);
    session.set("voiceConsentAt", undefined);
    session.set("voiceConsentVersion", undefined);
    await session.save();

    res.json({ session: session.toObject() });
  } catch (err) {
    console.error("[sessions] POST /:id/end", err);
    res.status(500).json({ message: "Failed to end session" });
  }
});

module.exports = router;
