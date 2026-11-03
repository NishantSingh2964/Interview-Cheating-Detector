const express = require("express");
const router = express.Router();
const Session = require("../models/Session");
const Violation = require("../models/Violation");

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

module.exports = router;
