const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Session = require("../models/Session");
const AnswerAnalysis = require("../models/AnswerAnalysis");
const { transcribeAudio } = require("../services/transcriptionService");
const { getAiLikelihoodBand, MIN_REVIEW_WORDS } = require("../services/answerAnalysisService");
const {
  detectFaceCount,
  detectObjects,
  isRekognitionConfigured,
  verifyRekognitionAccess,
} = require("../services/rekognitionService");

const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/mpeg",
]);
const MAX_ANSWER_CHARS = 20000;
const MAX_QUESTION_CHARS = 2000;
const ANSWER_RETENTION_DAYS = 7;
const ANSWER_CONSENT_VERSION = "answer-ai-likeness-v2";
const REKOGNITION_CONSENT_VERSION = "rekognition-proctoring-v1";
const REKOGNITION_FRAME_INTERVAL_MS = 5000;
const lastRekognitionFrameAt = new Map();

router.get("/rekognition/status", (_req, res) => {
  res.json({ enabled: isRekognitionConfigured() });
});

router.post("/rekognition/ready", async (req, res) => {
  try {
    if (req.get("x-rekognition-consent") !== REKOGNITION_CONSENT_VERSION) {
      return res.status(403).json({ message: "Consent is required before checking Amazon Rekognition." });
    }
    const { sessionId } = req.body ?? {};
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) {
      return res.status(400).json({ message: "A valid session ID is required." });
    }

    const session = await Session.findById(sessionId)
      .select("status +rekognitionFaceConsentAt +rekognitionFaceConsentVersion");
    if (!session) return res.status(404).json({ message: "Interview session not found." });
    if (session.status !== "active") {
      return res.status(409).json({ message: "This interview session is no longer active." });
    }
    if (
      !session.rekognitionFaceConsentAt ||
      session.rekognitionFaceConsentVersion !== REKOGNITION_CONSENT_VERSION
    ) {
      return res.status(403).json({ message: "Candidate consent for Amazon Rekognition is required." });
    }

    await verifyRekognitionAccess();
    res.json({ ready: true });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("[analysis] Rekognition readiness check failed:", error);
    res.status(503).json({
      message: "Amazon Rekognition is unavailable or missing DetectFaces/DetectLabels permissions.",
    });
  }
});

router.post(
  "/rekognition/:id/frame",
  express.raw({ type: "image/jpeg", limit: "1mb" }),
  async (req, res) => {
    try {
      if (req.get("x-rekognition-consent") !== REKOGNITION_CONSENT_VERSION) {
        return res.status(403).json({ message: "Consent is required before sending a frame for face analysis." });
      }
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ message: "A valid session ID is required." });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(415).json({ message: "A JPEG frame is required." });
      }

      const session = await Session.findById(req.params.id)
        .select("status +rekognitionFaceConsentAt +rekognitionFaceConsentVersion");
      if (!session) return res.status(404).json({ message: "Interview session not found." });
      if (session.status !== "active") {
        return res.status(409).json({ message: "This interview session is no longer active." });
      }
      if (
        !session.rekognitionFaceConsentAt ||
        session.rekognitionFaceConsentVersion !== REKOGNITION_CONSENT_VERSION
      ) {
        return res.status(403).json({ message: "Candidate consent for Amazon Rekognition is required." });
      }

      const now = Date.now();
      const lastRequestAt = lastRekognitionFrameAt.get(req.params.id) ?? 0;
      if (now - lastRequestAt < REKOGNITION_FRAME_INTERVAL_MS) {
        return res.status(429).json({ message: "Face frames may be submitted once every five seconds." });
      }
      lastRekognitionFrameAt.set(req.params.id, now);
      if (lastRekognitionFrameAt.size > 5000) {
        for (const [sessionId, timestamp] of lastRekognitionFrameAt) {
          if (now - timestamp > 60_000) lastRekognitionFrameAt.delete(sessionId);
        }
      }

      const [faceCount, objects] = await Promise.all([
        detectFaceCount(req.body),
        detectObjects(req.body),
      ]);
      res.json({ faceCount, objects });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("[analysis] Rekognition face analysis failed:", error);
      res.status(502).json({ message: "Amazon Rekognition could not analyze this frame." });
    }
  },
);

router.post(
  "/transcribe",
  express.raw({ type: "audio/*", limit: "25mb" }),
  async (req, res) => {
    try {
      if (req.get("x-answer-review-consent") !== ANSWER_CONSENT_VERSION) {
        return res.status(403).json({ message: "Candidate consent is required before transcribing an answer." });
      }
      const { sessionId, question } = req.query;
      const contentType = (req.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!sessionId || !mongoose.isValidObjectId(sessionId)) {
        return res.status(400).json({ message: "A valid sessionId is required." });
      }
      if (!Number.isInteger(Number(question)) || Number(question) < 1) {
        return res.status(400).json({ message: "A positive question number is required." });
      }
      if (!SUPPORTED_AUDIO_TYPES.has(contentType)) {
        return res.status(415).json({ message: "Use a supported browser audio recording format." });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ message: "An audio recording is required." });
      }

      const session = await Session.findById(sessionId)
        .select("status answerMode +answerReviewConsentAt +answerReviewConsentVersion");
      if (!session) return res.status(404).json({ message: "Interview session not found." });
      if (session.status !== "active") {
        return res.status(409).json({ message: "This interview session is no longer active." });
      }
      if (session.answerMode !== "speaking" ||
        !session.answerReviewConsentAt ||
        session.answerReviewConsentVersion !== ANSWER_CONSENT_VERSION) {
        return res.status(403).json({ message: "Speaking mode and answer-processing consent are required before transcription." });
      }

      const transcript = await transcribeAudio(req.body, contentType);
      if (!transcript.trim()) {
        return res.status(422).json({ message: "No speech was recognized. Please try recording again." });
      }
      res.json({ transcript });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("[analysis] transcription failed:", error);
      res.status(502).json({ message: "Transcription failed. Check the configured Whisper service, then retry." });
    }
  },
);

router.post("/", async (req, res) => {
  try {
    if (req.get("x-answer-review-consent") !== ANSWER_CONSENT_VERSION) {
      return res.status(403).json({ message: "Candidate consent is required before reviewing an answer." });
    }
    const { sessionId, question, prompt, answer, answerSource, pasteDetected } = req.body ?? {};
    if (!sessionId || !mongoose.isValidObjectId(sessionId)) {
      return res.status(400).json({ message: "A valid sessionId is required." });
    }
    if (!Number.isInteger(question) || question < 1) {
      return res.status(400).json({ message: "A positive question number is required." });
    }
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ message: "A valid question prompt is required." });
    }
    if (typeof answer !== "string" || !answer.trim() || answer.length > MAX_ANSWER_CHARS) {
      return res.status(400).json({ message: "A non-empty answer under 20,000 characters is required." });
    }
    if (!["typed", "spoken"].includes(answerSource)) {
      return res.status(400).json({ message: "answerSource must be typed or spoken." });
    }
    if (typeof pasteDetected !== "boolean") {
      return res.status(400).json({ message: "pasteDetected must be a boolean." });
    }

    const session = await Session.findById(sessionId)
      .select("status answerMode +answerReviewConsentAt +answerReviewConsentVersion");
    if (!session) return res.status(404).json({ message: "Interview session not found." });
    if (session.status !== "active") {
      return res.status(409).json({ message: "This interview session is no longer active." });
    }
    if (!session.answerReviewConsentAt ||
      session.answerReviewConsentVersion !== ANSWER_CONSENT_VERSION) {
      return res.status(403).json({ message: "Candidate answer-review consent is required." });
    }
    if ((session.answerMode === "writing" && answerSource !== "typed") ||
      (session.answerMode === "speaking" && answerSource !== "spoken")) {
      return res.status(400).json({ message: "answerSource must match the candidate's selected answer mode." });
    }

    const analyzedAt = new Date();
    const shortAnswer = answer.trim().split(/\s+/).length < MIN_REVIEW_WORDS;
    const answerAnalysis = await AnswerAnalysis.findOneAndUpdate(
      { sessionId, question },
      {
        $set: {
          prompt: prompt.trim(),
          answer: answer.trim(),
          answerSource,
          pasteDetected,
          aiLikelihoodScore: null,
          processingStatus: shortAnswer ? "not_scored" : "queued",
          attempts: 0,
          nextAttemptAt: shortAnswer ? null : analyzedAt,
          lockedAt: null,
          processingToken: null,
          lastError: null,
          analyzedAt,
          consentVersion: ANSWER_CONSENT_VERSION,
          consentedAt: analyzedAt,
          expiresAt: new Date(analyzedAt.getTime() + ANSWER_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        },
        $setOnInsert: { sessionId, question },
      },
      { new: true, upsert: true, runValidators: true },
    ).lean();

    res.status(202).json({
      answerAnalysis: {
        _id: answerAnalysis._id,
        question: answerAnalysis.question,
        prompt: answerAnalysis.prompt,
        answer: answerAnalysis.answer,
        answerSource: answerAnalysis.answerSource,
        pasteDetected: answerAnalysis.pasteDetected,
        aiLikelihoodScore: answerAnalysis.aiLikelihoodScore ?? null,
        aiLikelihoodBand: getAiLikelihoodBand(answerAnalysis.aiLikelihoodScore),
        processingStatus: answerAnalysis.processingStatus,
        attempts: answerAnalysis.attempts,
        lastError: answerAnalysis.lastError,
        nextAttemptAt: answerAnalysis.nextAttemptAt,
        analyzedAt: answerAnalysis.analyzedAt,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("[analysis] answer review failed:", error);
    res.status(502).json({ message: error.message || "Answer review failed. Check the configured model provider and try again." });
  }
});

router.post("/:id/retry", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid answer analysis ID is required." });
    }
    const answerAnalysis = await AnswerAnalysis.findOneAndUpdate(
      { _id: req.params.id, processingStatus: "failed" },
      {
        $set: {
          processingStatus: "queued",
          attempts: 0,
          nextAttemptAt: new Date(),
          lockedAt: null,
          processingToken: null,
          lastError: null,
          aiLikelihoodScore: null,
        },
      },
      { new: true },
    ).lean();
    if (!answerAnalysis) {
      return res.status(409).json({ message: "Only failed answer estimates can be retried." });
    }
    res.status(202).json({
      answerAnalysis: {
        _id: answerAnalysis._id,
        question: answerAnalysis.question,
        prompt: answerAnalysis.prompt,
        answer: answerAnalysis.answer,
        answerSource: answerAnalysis.answerSource,
        pasteDetected: answerAnalysis.pasteDetected,
        aiLikelihoodScore: null,
        aiLikelihoodBand: getAiLikelihoodBand(null),
        processingStatus: answerAnalysis.processingStatus,
        attempts: answerAnalysis.attempts,
        lastError: null,
        nextAttemptAt: answerAnalysis.nextAttemptAt,
        analyzedAt: answerAnalysis.analyzedAt,
      },
    });
  } catch (error) {
    console.error("[analysis] answer estimate retry failed:", error);
    res.status(500).json({ message: "Could not retry this answer estimate." });
  }
});

module.exports = router;
