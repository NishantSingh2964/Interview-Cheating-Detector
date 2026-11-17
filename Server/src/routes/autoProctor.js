const express = require("express");
const mongoose = require("mongoose");
const Session = require("../models/Session");
const AutoProctorEvent = require("../models/AutoProctorEvent");
const { createAutoProctorCredentials } = require("../services/autoProctorService");

const AUTOPROCTOR_CONSENT_VERSION = "autoproctor-proctoring-v1";
const EVIDENCE_LABELS = new Map([
  [5001, "No face detected"],
  [5002, "Multiple people detected"],
  [5003, "Random photo captured"],
  [5004, "Elevated audio detected"],
  [5005, "Interview tab lost focus"],
  [5006, "Interview tab regained focus"],
  [5007, "Multiple monitors detected"],
  [5008, "Multiple monitors suspected"],
  [5009, "Exited full screen"],
  [5010, "Audio monitoring started"],
  [5011, "Auxiliary device video uploaded"],
  [5012, "Object detected"],
  [5013, "Monitor connected after initial check"],
  [5014, "Multiple monitors blocked at start"],
  [5015, "Multiple monitor check bypassed"],
]);
const MAX_EVENTS_PER_SESSION = 500;
const router = express.Router();

router.post("/sessions/:id/credentials", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid session ID is required." });
    }
    if (
      req.body?.consent !== true ||
      req.body?.consentVersion !== AUTOPROCTOR_CONSENT_VERSION
    ) {
      return res.status(400).json({ message: "Explicit, current AutoProctor consent is required." });
    }

    const session = await Session.findById(req.params.id)
      .select("+autoProctorConsentAt +autoProctorConsentVersion");
    if (!session) return res.status(404).json({ message: "Interview session not found." });
    if (session.status !== "active") {
      return res.status(409).json({ message: "AutoProctor can only start for an active interview." });
    }

    const credentials = createAutoProctorCredentials(String(session._id));
    session.autoProctorConsentAt = new Date();
    session.autoProctorConsentVersion = AUTOPROCTOR_CONSENT_VERSION;
    await session.save();

    res.json(credentials);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("[autoproctor] POST /sessions/:id/credentials", error);
    res.status(500).json({ message: "Could not prepare AutoProctor for this interview." });
  }
});

router.post("/sessions/:id/events", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid session ID is required." });
    }

    const evidenceCode = req.body?.evidenceCode;
    const label = EVIDENCE_LABELS.get(evidenceCode);
    if (!label) {
      return res.status(400).json({ message: "Unsupported AutoProctor evidence code." });
    }

    const session = await Session.findById(req.params.id)
      .select("status +autoProctorConsentAt +autoProctorConsentVersion");
    if (!session) return res.status(404).json({ message: "Interview session not found." });
    if (session.status !== "active") {
      return res.status(409).json({ message: "AutoProctor events require an active interview." });
    }
    if (
      !session.autoProctorConsentAt ||
      session.autoProctorConsentVersion !== AUTOPROCTOR_CONSENT_VERSION
    ) {
      return res.status(403).json({ message: "Candidate consent for AutoProctor is required." });
    }

    const eventCount = await AutoProctorEvent.countDocuments({ sessionId: session._id });
    if (eventCount >= MAX_EVENTS_PER_SESSION) {
      return res.status(429).json({ message: "AutoProctor event limit reached for this interview." });
    }

    const event = await AutoProctorEvent.create({
      sessionId: session._id,
      evidenceCode,
      label,
      occurredAt: new Date(),
    });
    res.status(201).json({ event });
  } catch (error) {
    console.error("[autoproctor] POST /sessions/:id/events", error);
    res.status(500).json({ message: "Could not save this AutoProctor event." });
  }
});

module.exports = { router, AUTOPROCTOR_CONSENT_VERSION };
