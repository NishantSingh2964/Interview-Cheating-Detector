const mongoose = require("mongoose");

const VIOLATION_TYPES = [
  "no_face",
  "multiple_faces",
  "looking_away",
  "object_detected",
  "multiple_persons",
  "window",
  "fullscreen",
  "copy",
  "paste",
  "contextmenu",
  "sound",
  "heartbeat_lost",
  "other_voice",
];

const violationSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    question: { type: Number, required: true },
    type: { type: String, enum: VIOLATION_TYPES, required: true },
    reason: { type: String, default: "" },
    confidence: { type: Number, default: 1 },
    time: { type: Date, required: true },
  },
  { timestamps: false }
);

module.exports = mongoose.model("Violation", violationSchema);
