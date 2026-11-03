const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    candidateName: { type: String, required: true, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: ["active", "terminated", "ended"],
      default: "active",
    },
    currentQuestion: { type: Number, default: 1 },
    violationCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    lastHeartbeat: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

module.exports = mongoose.model("Session", sessionSchema);
