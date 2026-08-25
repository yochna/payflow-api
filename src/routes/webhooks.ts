import { Router, Response } from "express";
import pool from "../config/db";
import { protect, apiKeyAuth } from "../middleware/auth";
import { MerchantRequest } from "../types";

const router = Router();

// ─────────────────────────────────────────
// POST /api/webhooks/trigger
// Trigger a webhook event (called internally after payment events)
// ─────────────────────────────────────────
export const triggerWebhook = async (
  merchantId: number,
  eventType: string,
  payload: object
): Promise<void> => {
  try {
    await pool.query(
      `INSERT INTO webhook_events (merchant_id, event_type, payload, status, attempts)
       VALUES ($1, $2, $3, 'pending', 0)`,
      [merchantId, eventType, JSON.stringify(payload)]
    );
  } catch (err) {
    console.error("Failed to create webhook event:", err);
  }
};

// ─────────────────────────────────────────
// GET /api/webhooks
// All webhook events for merchant
// ─────────────────────────────────────────
router.get("/", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;
    const page = parseInt(req.query.page as string || "1");
    const limit = parseInt(req.query.limit as string || "10");
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let whereClause = "WHERE merchant_id = $1";
    const params: (string | number)[] = [merchantId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND status = $${paramCount}`;
      params.push(status);
    }

    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM webhook_events ${whereClause}`, params
    );
    const total = parseInt(totalResult.rows[0].count);

    const result = await pool.query(
      `SELECT * FROM webhook_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total }
    });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// POST /api/webhooks/retry/:id
// Manually retry a failed webhook
// ─────────────────────────────────────────
router.post("/retry/:id", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const merchantId = req.merchant!.id;

    const webhookResult = await pool.query(
      "SELECT * FROM webhook_events WHERE id = $1 AND merchant_id = $2",
      [id, merchantId]
    );

    if (webhookResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "Webhook event not found" });
      return;
    }

    const webhook = webhookResult.rows[0];

    if (webhook.status === "delivered") {
      res.status(400).json({ success: false, message: "Webhook already delivered" });
      return;
    }

    // simulate delivery attempt
    const delivered = Math.random() > 0.3; // 70% success rate simulation

    await pool.query(
      `UPDATE webhook_events
       SET
         status = $1,
         attempts = attempts + 1,
         delivered_at = $2,
         next_retry_at = $3
       WHERE id = $4`,
      [
        delivered ? "delivered" : "failed",
        delivered ? new Date() : null,
        delivered ? null : new Date(Date.now() + 5 * 60 * 1000), // retry in 5 min
        id
      ]
    );

    res.json({
      success: true,
      message: delivered ? "Webhook delivered successfully" : "Delivery failed — scheduled for retry",
      data: { id, delivered, attempts: webhook.attempts + 1 }
    });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

export default router;