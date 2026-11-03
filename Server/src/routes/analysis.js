const express = require("express");
const router = express.Router();

/**
 * POST /api/analysis
 * Placeholder for AI-response detection.
 * In a real implementation this would call an external AI-detector API.
 */
router.post("/", async (req, res) => {
  try {
    const { sessionId, question, answer } = req.body;

    if (!answer || typeof answer !== "string") {
      return res.status(400).json({ message: "answer is required" });
    }

    // Placeholder — always returns 0% AI likelihood
    res.json({
      aiLikelihood: 0,
      note: "AI detection is not yet implemented. This is a placeholder response.",
    });
  } catch (err) {
    console.error("[analysis] POST /", err);
    res.status(500).json({ message: "Analysis failed" });
  }
});

module.exports = router;
