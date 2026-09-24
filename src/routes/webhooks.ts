import { Router, Response } from "express";
import crypto from "crypto";
import pool from "../config/db";
import { protect } from "../middleware/auth";
import { ApiError, asyncHandler } from "../middleware/error";
import { MerchantRequest } from "../types";

const router = Router();

const DELIVERY_TIMEOUT_MS = 5000;

/**
 * Attempt real HTTP delivery of a webhook event to the merchant's webhook_url.
 *
 * The payload is signed with HMAC-SHA256 using the merchant's api_secret so the
 * receiver can verify authenticity. Delivery is performed in-process with a
 * short timeout; failures are recorded for manual retry.
 */
export const deliverWebhook = async (
  merchantId: number,
  eventId: number,
  eventType: string,
  payload: object
): Promise<void> => {
  try {
    const merchantResult = await pool.query(
      "SELECT webhook_url, api_secret FROM merchants WHERE id = $1",
      [merchantId]
    );
    const merchant = merchantResult.rows[0];

    // No endpoint configured — leave the event pending.
    if (!merchant?.webhook_url) return;

    const body = JSON.stringify({
      event_id: eventId,
      event_type: eventType,
      payload,
      delivered_at: new Date().toISOString(),
    });

    const signature = crypto.createHmac("sha256", merchant.api_secret).update(body).digest("hex");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let delivered = false;
    try {
      const response = await fetch(merchant.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-payflow-event": eventType,
          "x-payflow-signature": `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });
      delivered = response.ok;
    } catch {
      delivered = false;
    } finally {
      clearTimeout(timeout);
    }

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
        eventId,
      ]
    );
  } catch (err) {
    console.error("Failed to deliver webhook event:", err);
  }
};

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
    const result = await pool.query(
      `INSERT INTO webhook_events (merchant_id, event_type, payload, status, attempts)
       VALUES ($1, $2, $3, 'pending', 0)
       RETURNING id`,
      [merchantId, eventType, JSON.stringify(payload)]
    );

    const eventId = result.rows[0].id;
    await deliverWebhook(merchantId, eventId, eventType, payload);
  } catch (err) {
    console.error("Failed to create webhook event:", err);
  }
};

// ─────────────────────────────────────────
// GET /api/webhooks
// All webhook events for merchant
// ─────────────────────────────────────────
router.get(
  "/",
  protect,
  asyncHandler(async (req: MerchantRequest, res: Response) => {
    const merchantId = req.merchant!.id;
    const page = parseInt((req.query.page as string) || "1");
    const limit = parseInt((req.query.limit as string) || "10");
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
      `SELECT COUNT(*) FROM webhook_events ${whereClause}`,
      params
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
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
    });
  })
);

// ─────────────────────────────────────────
// POST /api/webhooks/retry/:id
// Manually retry a failed webhook (real HTTP delivery)
// ─────────────────────────────────────────
router.post(
  "/retry/:id",
  protect,
  asyncHandler(async (req: MerchantRequest, res: Response) => {
    const { id } = req.params;
    const merchantId = req.merchant!.id;

    const webhookResult = await pool.query(
      "SELECT * FROM webhook_events WHERE id = $1 AND merchant_id = $2",
      [id, merchantId]
    );

    if (webhookResult.rows.length === 0) {
      throw new ApiError("Webhook event not found", 404);
    }

    const webhook = webhookResult.rows[0];

    if (webhook.status === "delivered") {
      throw new ApiError("Webhook already delivered", 400);
    }

    await deliverWebhook(merchantId, Number(id), webhook.event_type, webhook.payload);

    const updated = await pool.query("SELECT * FROM webhook_events WHERE id = $1", [id]);
    const event = updated.rows[0];

    res.json({
      success: true,
      message:
        event.status === "delivered"
          ? "Webhook delivered successfully"
          : "Delivery failed — scheduled for retry",
      data: { id, delivered: event.status === "delivered", attempts: event.attempts },
    });
  })
);

export default router;
