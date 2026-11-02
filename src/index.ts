import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import pool from "./config/db";

const REQUIRED_ENV = ["JWT_SECRET", "REFRESH_SECRET"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => console.log(`🚀 PayFlow API running on port ${PORT}`));

const shutdown = (signal: string): void => {
  console.log(`${signal} received — draining connections`);
  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error("Error while closing the database pool:", err);
      process.exit(1);
    }
  });

  // Never hang a deploy waiting for a stuck connection.
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
