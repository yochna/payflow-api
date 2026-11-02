import { Router, Response, NextFunction } from "express";
import pool from "../config/db";
import { apiKeyAuth, protect } from "../middleware/auth";
import { ApiError, asyncHandler } from "../middleware/error";
import { MerchantRequest } from "../types";
import { isFullyRefunded, remainingAfterRefund, round2 } from "../services/settlement";
import { parseAmount, parsePagination, parsePositiveInt } from "../utils/validation";

const router = Router();
interface RefundBody {
  payment_id: number;
  amount: number;
  reason?: string;
  initiated_by?: "merchant" | "customer" | "admin";
}

// POST /api/refunds
// Initiate a refund
router.post(
  "/",
  apiKeyAuth,
  asyncHandler(async (req: MerchantRequest, res: Response, next: NextFunction) => {
    const body = req.body as RefundBody;
    const paymentId = parsePositiveInt(body.payment_id, "payment_id");
    const amount = parseAmount(body.amount);
    const reason = body.reason;

    if (reason && String(reason).length > 255) {
      throw new ApiError("reason must be at most 255 characters", 400);
    }

    const { initiated_by = "merchant" } = body;
    const merchantId = req.merchant!.id;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /*
       * Lock the payment row so two concurrent refunds cannot both read the
       * same remaining balance and refund past the captured amount.
       */
      const paymentResult = await client.query(
        "SELECT * FROM payments WHERE id = $1 AND merchant_id = $2 FOR UPDATE",
        [paymentId, merchantId]
      );
      if (paymentResult.rows.length === 0) {
        throw new ApiError("Payment not found", 404);
      }
      const payment = paymentResult.rows[0];

      // only captured payments can be refunded
      if (payment.status !== "captured" && payment.status !== "partially_refunded") {
        throw new ApiError(
          `Only captured payments can be refunded. Current status: ${payment.status}`,
          400
        );
      }

      // check total refunded so far
      const refundedResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as total_refunded
         FROM refunds
         WHERE payment_id = $1 AND status != 'failed'`,
        [paymentId]
      );
      const totalRefunded = parseFloat(refundedResult.rows[0].total_refunded);
      const paymentAmount = parseFloat(payment.amount);
      const remainingAmount = round2(paymentAmount - totalRefunded);

      // check if refunded amount is valid
      if (amount > remainingAmount) {
        throw new ApiError(
          `Refund amount exceeds remaining refundable amount. Remaining: ${remainingAmount}`,
          400
        );
      }

      // create refund
      const refundResult = await client.query(
        `INSERT INTO refunds (payment_id, amount, reason, status, initiated_by, processed_at)
         VALUES ($1, $2, $3, 'refunded', $4, NOW())
         RETURNING *`,
        [paymentId, amount, reason || "Refund requested", initiated_by]
      );

      const refund = refundResult.rows[0];

      // update payment status
      const newStatus = isFullyRefunded(amount, remainingAmount)
        ? "refunded"
        : "partially_refunded";
      await client.query("UPDATE payments SET status = $1 WHERE id = $2", [newStatus, paymentId]);

      // update settlements - reduce net amount (cannot go below zero)
      await client.query(
        `UPDATE settlements
         SET net_amount = GREATEST(net_amount - $1, 0)
         WHERE payment_id = $2`,
        [amount, paymentId]
      );

      // audit log — refund itself
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, performed_by)
         VALUES ('refund', $1, 'created', $2, $3)`,
        [refund.id, JSON.stringify(refund), merchantId]
      );

      // audit log — payment state change, so the payment timeline stays complete
      await client.query(
        `INSERT INTO audit_logs
            (entity_type, entity_id, action, old_value, new_value, performed_by)
         VALUES ('payment', $1, 'refunded', $2, $3, $4)`,
        [
          paymentId,
          JSON.stringify({ status: payment.status }),
          JSON.stringify({ status: newStatus, refund_id: refund.id, amount }),
          merchantId,
        ]
      );
      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Refund processed successfully",
        data: {
          refund,
          payment_status: newStatus,
          refunded_amount: amount,
          remaining_refundable: remainingAfterRefund(remainingAmount, amount),
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      next(err);
    } finally {
      client.release();
    }
  })
);

// GET /api/refunds/:id
// Get refund status
router.get(
  "/:id",
  apiKeyAuth,
  asyncHandler(async (req: MerchantRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id, "refund id");
    const merchantId = req.merchant!.id;

    const result = await pool.query(
      `SELECT r.*, p.amount as payment_amount, p.status as payment_status
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       WHERE r.id = $1 AND p.merchant_id = $2`,
      [id, merchantId]
    );
    if (result.rows.length === 0) {
      throw new ApiError("Refund not found", 404);
    }
    res.json({ success: true, data: result.rows[0] });
  })
);

// GET /api/refunds
// All refunds for merchant
router.get(
  "/",
  protect,
  asyncHandler(async (req: MerchantRequest, res: Response) => {
    const merchantId = req.merchant!.id;
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit);

    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.merchant_id = $1`,
      [merchantId]
    );
    const total = parseInt(totalResult.rows[0].count);

    const result = await pool.query(
      `SELECT r.*, p.amount as payment_amount, p.payment_method
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.merchant_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset]
    );
    res.json({
      success: true,
      data: result.rows,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRefunds: total },
    });
  })
);

export default router;
