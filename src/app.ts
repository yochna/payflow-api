import dotenv from "dotenv";
dotenv.config();

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

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  })
);
app.use(express.json({ limit: "10kb" }));

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

app.get("/", (req: Request, res: Response) => {
  res.json({
    name: "PayFlow API",
    version: "1.0.0",
    status: "operational",
    documentation: "/api/docs",
    health: "/api/health",
  });
});

// health check
app.get("/api/health", async (req: Request, res: Response): Promise<void> => {
  try {
    await pool.query("SELECT 1");
    res.json({ success: true, message: "PayFlow API running", db: "connected" });
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
