const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Session = require("../models/Session");
const Violation = require("../models/Violation");
const AnswerAnalysis = require("../models/AnswerAnalysis");
const AutoProctorEvent = require("../models/AutoProctorEvent");
const { getAiLikelihoodBand } = require("../services/answerAnalysisService");

const ANSWER_CONSENT_VERSION = "answer-ai-likeness-v2";

router.post("/:id/preferences", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid session ID is required." });
    }
    const { answerMode, answerReviewConsent } = req.body ?? {};
    if (!["writing", "speaking"].includes(answerMode)) {
      return res.status(400).json({ message: "answerMode must be writing or speaking." });
    }
    if (typeof answerReviewConsent !== "boolean") {
      return res.status(400).json({ message: "answerReviewConsent must be a boolean." });
    }
    if (answerMode === "speaking" && !answerReviewConsent) {
      return res.status(400).json({ message: "Speaking mode requires consent for local transcription." });
    }

    const session = await Session.findOne({ _id: req.params.id, status: "active" })
      .select("+answerReviewConsentAt +answerReviewConsentVersion");
    if (!session) {
      const exists = await Session.exists({ _id: req.params.id });
      return res.status(exists ? 409 : 404).json({
        message: exists ? "Interview preferences can only be set for an active session." : "Interview session not found.",
      });
    }
    const alreadyConsented = Boolean(
      session.answerReviewConsentAt &&
      session.answerReviewConsentVersion === ANSWER_CONSENT_VERSION,
    );
    if (session.answerMode) {
      if (session.answerMode !== answerMode || alreadyConsented !== answerReviewConsent) {
        return res.status(409).json({ message: "Interview preferences have already been saved." });
      }
      return res.json({ session });
    }
    if (await AnswerAnalysis.exists({ sessionId: session._id })) {
      return res.status(409).json({ message: "Interview preferences cannot be changed after answer submission." });
    }
    session.answerMode = answerMode;
    session.answerReviewConsentAt = answerReviewConsent ? new Date() : null;
    session.answerReviewConsentVersion = answerReviewConsent ? ANSWER_CONSENT_VERSION : null;
    await session.save();
    res.json({ session });
  } catch (error) {
    console.error("[sessions] POST /:id/preferences", error);
    res.status(500).json({ message: "Failed to save interview preferences." });
  }
});

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
    const session = await Session.findById(req.params.id)
      .select(
        "+answerReviewConsentAt +answerReviewConsentVersion +autoProctorConsentAt +autoProctorConsentVersion",
      )
      .lean();
    if (!session) return res.status(404).json({ message: "Session not found" });

    const violations = await Violation.find({ sessionId: session._id })
      .sort({ time: -1 })
      .lean();
    const storedAnswerAnalyses = await AnswerAnalysis.find({ sessionId: session._id })
      .select("question prompt answer answerSource pasteDetected aiLikelihoodScore processingStatus attempts nextAttemptAt lastError analyzedAt")
      .sort({ question: 1 })
      .lean();
    const answerAnalyses = storedAnswerAnalyses.map((analysis) => ({
      ...analysis,
      aiLikelihoodBand: getAiLikelihoodBand(analysis.aiLikelihoodScore),
      processingStatus: analysis.processingStatus ??
        (typeof analysis.aiLikelihoodScore === "number" ? "completed" : "not_scored"),
      attempts: analysis.attempts ?? 0,
      nextAttemptAt: analysis.nextAttemptAt ?? null,
      lastError: analysis.lastError ?? null,
    }));
    const autoProctorEvents = await AutoProctorEvent.find({ sessionId: session._id })
      .sort({ occurredAt: -1 })
      .lean();

    res.json({ session, violations, answerAnalyses, autoProctorEvents });
  } catch (err) {
    console.error("[sessions] GET /:id", err);
    res.status(500).json({ message: "Failed to fetch session" });
  }
});

/**
 * POST /api/sessions/:id/end
 * Mark an active interview as ended. Repeated requests are safe.
 */
router.post("/:id/end", async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Session not found" });

    if (session.status === "active") {
      session.status = "ended";
      session.endedAt = new Date();
      session.endReason = "submitted";
    }
    await session.save();

    res.json({ session: session.toObject() });
  } catch (err) {
    console.error("[sessions] POST /:id/end", err);
    res.status(500).json({ message: "Failed to end session" });
  }
});

module.exports = router;
