const mongoose = require("mongoose");

const answerAnalysisSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    question: { type: Number, required: true, min: 1 },
    prompt: { type: String, required: true, maxlength: 2000 },
    answer: { type: String, required: true, maxlength: 20000 },
    answerSource: { type: String, enum: ["typed", "spoken"], required: true, default: "spoken" },
    pasteDetected: { type: Boolean, required: true, default: false },
    aiLikelihoodScore: { type: Number, min: 0, max: 100, default: null },
    processingStatus: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "not_scored"],
      required: true,
      default: "queued",
    },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    processingToken: { type: String, default: null, select: false },
    lastError: { type: String, default: null, maxlength: 500 },
    analyzedAt: { type: Date, required: true },
    consentVersion: { type: String, required: true },
    consentedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

answerAnalysisSchema.index({ sessionId: 1, question: 1 }, { unique: true });
answerAnalysisSchema.index({ processingStatus: 1, nextAttemptAt: 1, analyzedAt: 1 });
answerAnalysisSchema.index({ processingStatus: 1, lockedAt: 1 });
answerAnalysisSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AnswerAnalysis", answerAnalysisSchema);
