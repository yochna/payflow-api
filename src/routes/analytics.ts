import { Router, Response } from "express";
import pool from "../config/db";
import { protect } from "../middleware/auth";
import { MerchantRequest } from "../types";

const router = Router();

// ─────────────────────────────────────────
// GET /api/analytics/success-rate
// Payment success rate
// ─────────────────────────────────────────
router.get("/success-rate", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;
    const days = parseInt(req.query.days as string || "30");

    const result = await pool.query(
      `SELECT
         COUNT(*) as total_payments,
         COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful,
         COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
         COUNT(CASE WHEN status IN ('refunded', 'partially_refunded') THEN 1 END) as refunded,
         ROUND(
           COUNT(CASE WHEN status = 'captured' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
           2
         ) as success_rate,
         SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as successful_volume
       FROM payments
       WHERE merchant_id = $1
         AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [merchantId, days]
    );

    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/analytics/failure-reasons
// Why payments fail
// ─────────────────────────────────────────
router.get("/failure-reasons", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;

    const result = await pool.query(
      `SELECT
         failure_reason,
         COUNT(*) as count,
         ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as percentage
       FROM payments
       WHERE merchant_id = $1 AND status = 'failed'
       GROUP BY failure_reason
       ORDER BY count DESC`,
      [merchantId]
    );

    res.json({ success: true, data: result.rows });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/analytics/volume
// Daily/weekly payment volume
// ─────────────────────────────────────────
router.get("/volume", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;
    const groupBy = req.query.group_by as string || "day";

    const dateTrunc = groupBy === "week" ? "week" : groupBy === "month" ? "month" : "day";

    const result = await pool.query(
      `SELECT
         DATE_TRUNC($1, created_at) as period,
         COUNT(*) as total_payments,
         COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful,
         SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as volume,
         ROUND(AVG(CASE WHEN status = 'captured' THEN amount END), 2) as avg_payment
       FROM payments
       WHERE merchant_id = $2
         AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY DATE_TRUNC($1, created_at)
       ORDER BY period DESC`,
      [dateTrunc, merchantId]
    );

    res.json({ success: true, data: result.rows });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/analytics/payment-methods
// Breakdown by payment method
// ─────────────────────────────────────────
router.get("/payment-methods", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;

    const result = await pool.query(
      `SELECT
         payment_method,
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful,
         SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as volume,
         ROUND(
           COUNT(CASE WHEN status = 'captured' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
           2
         ) as success_rate,
         ROUND(AVG(CASE WHEN status = 'captured' THEN amount END), 2) as avg_amount
       FROM payments
       WHERE merchant_id = $1
       GROUP BY payment_method
       ORDER BY volume DESC`,
      [merchantId]
    );

    res.json({ success: true, data: result.rows });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/analytics/summary
// Complete dashboard summary
// ─────────────────────────────────────────
router.get("/summary", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;

    // today's stats
    const todayResult = await pool.query(
      `SELECT
         COUNT(*) as today_payments,
         SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as today_volume,
         COUNT(CASE WHEN status = 'captured' THEN 1 END) as today_successful
       FROM payments
       WHERE merchant_id = $1
         AND DATE(created_at) = CURRENT_DATE`,
      [merchantId]
    );

    // this month stats
    const monthResult = await pool.query(
      `SELECT
         COUNT(*) as month_payments,
         SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as month_volume,
         ROUND(AVG(CASE WHEN status = 'captured' THEN amount END), 2) as avg_payment
       FROM payments
       WHERE merchant_id = $1
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
      [merchantId]
    );

    // pending settlements
    const pendingResult = await pool.query(
      `SELECT
         COUNT(*) as pending_count,
         SUM(net_amount) as pending_amount
       FROM settlements
       WHERE merchant_id = $1 AND status = 'pending'`,
      [merchantId]
    );

    // top payment method
    const topMethodResult = await pool.query(
      `SELECT payment_method, COUNT(*) as count
       FROM payments
       WHERE merchant_id = $1 AND status = 'captured'
       GROUP BY payment_method
       ORDER BY count DESC
       LIMIT 1`,
      [merchantId]
    );

    res.json({
      success: true,
      data: {
        today: todayResult.rows[0],
        this_month: monthResult.rows[0],
        pending_settlements: pendingResult.rows[0],
        top_payment_method: topMethodResult.rows[0] || null
      }
    });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

export default router;