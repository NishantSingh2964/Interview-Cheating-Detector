const mongoose = require("mongoose");

const autoProctorEventSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    evidenceCode: {
      type: Number,
      enum: [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010],
      required: true,
    },
    label: { type: String, required: true },
    occurredAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

autoProctorEventSchema.index({ sessionId: 1, occurredAt: -1 });

module.exports = mongoose.model("AutoProctorEvent", autoProctorEventSchema);
