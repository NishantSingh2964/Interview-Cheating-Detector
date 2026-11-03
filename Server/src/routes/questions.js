const express = require("express");
const router = express.Router();

/**
 * Hardcoded interview questions.
 * GET /api/questions returns the full list.
 */
const QUESTIONS = [
  {
    id: 1,
    prompt:
      "Walk through a project you built. What was hard, and what did you change after it shipped?",
    hint: "Speak to the camera. Keep the answer in your own words.",
  },
  {
    id: 2,
    prompt:
      "Tell us about a time you disagreed with a teammate. How did you resolve it?",
    hint: "Focus on what you did, not only the outcome.",
  },
  {
    id: 3,
    prompt:
      "Describe a bug that took you a long time to find. How did you narrow it down?",
    hint: "Name the signals you used, not just the fix.",
  },
  {
    id: 4,
    prompt:
      "What is a weakness you are working on, and what do you do about it in practice?",
    hint: "A specific example is more useful than a label.",
  },
  {
    id: 5,
    prompt:
      "What kind of work do you want to be doing two years from now, and why?",
    hint: "Connect it to something you have already started.",
  },
];

router.get("/", (_req, res) => {
  res.json(QUESTIONS);
});

module.exports = router;
