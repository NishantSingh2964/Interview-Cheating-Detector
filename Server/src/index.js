require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server: SocketServer } = require("socket.io");

const connectDB = require("./config/db");
const registerProctorSocket = require("./sockets/proctor");
const { startAnswerReviewWorker } = require("./services/answerReviewQueue");
const {
  createClientOriginCallback,
  getAllowedClientOrigins,
  getVercelPreviewHostPattern,
} = require("./config/clientOrigins");

const sessionsRouter = require("./routes/sessions");
const questionsRouter = require("./routes/questions");
const analysisRouter = require("./routes/analysis");

const PORT = process.env.PORT || 4000;
const allowedClientOrigins = getAllowedClientOrigins();
const previewHostPattern = getVercelPreviewHostPattern();
const validateClientOrigin = createClientOriginCallback(
  allowedClientOrigins,
  previewHostPattern,
);

async function main() {
  // ── Database ────────────────────────────────────────────────
  await connectDB();
  startAnswerReviewWorker();

  // ── Express ─────────────────────────────────────────────────
  const app = express();
  app.use(cors({ origin: validateClientOrigin, credentials: true }));
  app.use(express.json());

  // Health check
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "interview-proctor-server" });
  });

  // REST routes
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/questions", questionsRouter);
  app.use("/api/analysis", analysisRouter);

  // ── HTTP + Socket.IO ────────────────────────────────────────
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    maxHttpBufferSize: 1_100_000,
    cors: {
      origin: validateClientOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  registerProctorSocket(io);

  // ── Start ───────────────────────────────────────────────────
  server.listen(PORT, () => {
    console.log(`\n  ✦ Interview Proctor Server`);
    console.log(`    REST  → http://localhost:${PORT}`);
    console.log(`    WS    → http://localhost:${PORT} (Socket.IO)`);
    const previewLabel = previewHostPattern
      ? " + configured Vercel branch previews"
      : "";
    console.log(`    CORS  → ${[...allowedClientOrigins].join(", ")}${previewLabel}\n`);
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
