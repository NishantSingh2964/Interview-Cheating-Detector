const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    candidateName: { type: String, required: true, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: ["active", "terminated", "ended"],
      default: "active",
    },
    endReason: {
      type: String,
      enum: ["submitted", "heartbeat_timeout", "violation_limit", "proctoring_unavailable"],
      default: null,
    },
    currentQuestion: { type: Number, default: 1 },
    violationCount: { type: Number, default: 0 },
    answerMode: { type: String, enum: ["writing", "speaking"], default: null },
    answerReviewConsentAt: { type: Date, default: null, select: false },
    answerReviewConsentVersion: { type: String, default: null, select: false },
    rekognitionFaceConsentAt: { type: Date, default: null, select: false },
    rekognitionFaceConsentVersion: { type: String, default: null, select: false },
    voiceEnrolled: { type: Boolean, default: false },
    voiceprint: { type: [Number], select: false },
    voiceConsentAt: { type: Date, select: false },
    voiceConsentVersion: { type: String, select: false },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    lastHeartbeat: { type: Date, default: null },
  },
  { timestamps: false }
);

module.exports = mongoose.model("Session", sessionSchema);
