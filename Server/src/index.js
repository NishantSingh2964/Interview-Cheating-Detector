require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server: SocketServer } = require("socket.io");

const connectDB = require("./config/db");
const registerProctorSocket = require("./sockets/proctor");

const sessionsRouter = require("./routes/sessions");
const questionsRouter = require("./routes/questions");
const analysisRouter = require("./routes/analysis");

const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

async function main() {
  // ── Database ────────────────────────────────────────────────
  await connectDB();

  // ── Express ─────────────────────────────────────────────────
  const app = express();
  app.use(cors({ origin: CLIENT_URL, credentials: true }));
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
    cors: {
      origin: CLIENT_URL,
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
    console.log(`    CORS  → ${CLIENT_URL}\n`);
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
