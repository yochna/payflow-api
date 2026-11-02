import dotenv from "dotenv";
dotenv.config();

import path from "path";
import crypto from "crypto";
import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";

import authRoutes from "./routes/auth";
import paymentRoutes from "./routes/payments";
import refundRoutes from "./routes/refunds";
import settlementRoutes from "./routes/settlements";
import analyticsRoutes from "./routes/analytics";
import webhookRoutes from "./routes/webhooks";
import pool from "./config/db";
import { globalErrorHandler } from "./middleware/error";
import { swaggerSpec } from "./config/swagger";

const app: Application = express();

// Render terminates TLS in front of the app; trust its proxy headers so rate
// limiting sees real client IPs instead of the proxy's.
app.set("trust proxy", 1);

// Correlate logs and client-side errors with a single request id.
app.use((req: Request, res: Response, next) => {
  const requestId = req.header("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  next();
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  })
);
app.use(express.json({ limit: "10kb" }));

// landing page (public/index.html)
app.use(express.static(path.join(__dirname, "..", "public")));

// rate limiting (disabled in tests so suites can run quickly)
if (process.env.NODE_ENV !== "test") {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many requests, please try again later" },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts, please try again later" },
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth", authLimiter);
}

// swagger docs
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/refunds", refundRoutes);
app.use("/api/settlements", settlementRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/webhooks", webhookRoutes);

// health check
app.get("/api/health", async (req: Request, res: Response): Promise<void> => {
  const startedAt = Date.now();
  try {
    await pool.query("SELECT 1");
    res.json({
      success: true,
      message: "PayFlow API running",
      db: "connected",
      dbLatencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version || "1.0.0",
    });
  } catch {
    res.status(500).json({ success: false, message: "DB connection failed" });
  }
});

// 404
app.use((req: Request, res: Response): void => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// error handler
app.use(globalErrorHandler);

export default app;
