const mongoose = require("mongoose");
const dns = require("dns");

/**
 * Connect to MongoDB Atlas.
 * Uses Google DNS for SRV resolution (some networks block SRV queries).
 * Retries once after 5 s if the first attempt fails.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("[db] MONGODB_URI is not set in .env");
    process.exit(1);
  }

  // Use Google public DNS so mongodb+srv:// SRV lookups work
  // even on networks that block SRV queries on the default resolver.
  dns.setServers(["8.8.8.8", "8.8.4.4"]);

  try {
    await mongoose.connect(uri);
    console.log("[db] Connected to MongoDB");
  } catch (err) {
    console.error("[db] Initial connection failed, retrying in 5 s …", err.message);
    await new Promise((r) => setTimeout(r, 5000));
    await mongoose.connect(uri);
    console.log("[db] Connected to MongoDB (retry)");
  }
}

module.exports = connectDB;
