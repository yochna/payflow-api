import { Router, Response } from "express";
import pool from "../config/db";
import { apiKeyAuth, protect } from "../middleware/auth";
import { MerchantRequest } from "../types";

const router = Router();
interface RefundBody {
  payment_id: number;
  amount: number;
  reason?: string;
  initiated_by?: "merchant" | "customer" | "admin";
}

// post/api/refunds
// initiate a refund
router.post(
  "/",
  apiKeyAuth,
  async (req: MerchantRequest, res: Response): Promise<void> => {
    const client = await pool.connect();

    try {
      const {
        payment_id,
        amount,
        reason,
        initiated_by = "merchant",
      } = req.body as RefundBody;
      const merchantId = req.merchant!.id;

      if (!payment_id || !amount) {
        res
          .status(400)
          .json({ success: false, message: "payment_id and amount required" });
        return;
      }
      if (amount <= 0) {
        res
          .status(400)
          .json({
            success: false,
            message: "Refund amount must be greater than 0",
          });
        return;
      }
      await client.query("BEGIN");

      
      const paymentResult = await client.query(
        "SELECT * FROM payments WHERE id = $1 AND merchant_id = $2", // <-- Fixed
        [payment_id, merchantId],
      );
      if (paymentResult.rows.length === 0) {
        res.status(404).json({ success: false, message: "Payment not found" });
        return;
      }
      const payment = paymentResult.rows[0];

      // only captured payments can be refunded (fixed messagee typo)
      if (payment.status !== "captured" && payment.status !== "partially_refunded") {
        res.status(400).json({
          success: false,
          message: `Only captured payments can be refunded. Current status: ${payment.status}`,
        });
        return;
      }

      // check total refunded so far
      const refundedResult = await client.query(
        `SELECT COALESCE(SUM(amount),0) as total_refunded
            FROM refunds
            WHERE payment_id = $1 AND status !='failed'`,
        [payment_id],
      );
      const totalRefunded = parseFloat(refundedResult.rows[0].total_refunded);
      const paymentAmount = parseFloat(payment.amount);
      const remainingAmount = paymentAmount - totalRefunded;

      // check if refunded amount is valid
      if (amount > remainingAmount) {
        res.status(400).json({
          success: false,
          message: `Refund amount exceeds remaining refundable amount. Remaining: ${remainingAmount}`,
        });
        return;
      }

      // create refund (fixed payment_id spelling)
      const refundResult = await client.query(
        `INSERT INTO refunds (payment_id, amount, reason, status, initiated_by, processed_at)
            VALUES($1, $2, $3, 'refunded', $4, NOW())
            RETURNING *`,
        [payment_id, amount, reason || "Refund requested", initiated_by],
      );

      const refund = refundResult.rows[0];

      // update payment status
      const newStatus =
        amount >= remainingAmount ? "refunded" : "partially_refunded";
      await client.query("UPDATE payments SET status = $1 WHERE id = $2", [
        newStatus,
        payment_id,
      ]);

      // update settlements - reduce net amount (added missing comma and fixed payment_id spelling)
      await client.query(
        `UPDATE settlements 
            SET net_amount = net_amount - $1,
                status = CASE WHEN net_amount - $1 <= 0 THEN 'failed' ELSE status END
            WHERE payment_id = $2`,
        [amount, payment_id],
      );

      // audit log
      await client.query(
        `INSERT INTO audit_logs(entity_type, entity_id, action, new_value, performed_by)
            VALUES ('refund', $1, 'created', $2, $3)`,
        [refund.id, JSON.stringify(refund), merchantId],
      );
      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: `Refund processed successfully`,
        data: {
          refund,
          payment_status: newStatus,
          refunded_amount: amount,
          remaining_refundable: remainingAmount - amount,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof Error)
        res.status(500).json({ success: false, message: err.message });
    } finally {
      client.release();
    }
  },
);

// get /api/refunds/:id
// get refunded status
router.get("/:id", apiKeyAuth, async (req: MerchantRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const merchantId = req.merchant!.id;

        const result = await pool.query(
            `SELECT r.*, p.amount as payment_amount, p.status as payment_status
            FROM refunds r
            JOIN payments p ON p.id = r.payment_id
            WHERE r.id = $1 AND p.merchant_id = $2`,
            [id, merchantId]
        );
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, message: "Refund not found" });
            return;
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
    }
});

// get /api/refunds
// All refunded for merchant
// get /api/refunds
// All refunded for merchant
router.get("/", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
    try {
        const merchantId = req.merchant!.id;
        const page = parseInt((req.query.page as string) || "1");
        const limit = parseInt((req.query.limit as string) || "10");
        const offset = (page - 1) * limit;

        // Fixed merchnat_id typo here
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
            pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRefunds: total }
        });

    } catch (err) {
        if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
    }
});

export default router;