import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/db";
import { apiKeyAuth, protect } from "../middleware/auth";
import { MerchantRequest } from "../types";
import { triggerWebhook } from "./webhooks";

const router = Router();

interface CreatePaymentBody {
  amount: number;
  payment_method: "upi" | "card" | "netbanking" | "wallet";
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  idempotency_key?: string;
}

interface UpdatePaymentBody {
  status?: string;
  failure_reason?: string;
}

router.post("/create", apiKeyAuth, async (req: MerchantRequest, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const { amount, payment_method, customer_name, customer_email, customer_phone, idempotency_key } = req.body as CreatePaymentBody;
    const merchantId = req.merchant!.id;

    if (!amount || !payment_method) {
      res.status(400).json({ success: false, message: "Amount and payment_method required" });
      return;
    }
    if (amount <= 0) {
      res.status(400).json({ success: false, message: "Amount must be greater than 0" });
      return;
    }
    const validMethods = ["upi", "card", "netbanking", "wallet"];
    if (!validMethods.includes(payment_method)) {
      res.status(400).json({ success: false, message: "Invalid payment method" });
      return;
    }

    if (idempotency_key) {
      const existing = await client.query(
        "SELECT * FROM payments WHERE idempotency_key = $1 AND merchant_id = $2",
        [idempotency_key, merchantId]
      );
      if (existing.rows.length > 0) {
        res.status(200).json({ success: true, message: "Payment already exists (idempotent response)", data: existing.rows[0] });
        return;
      }
    }

    await client.query("BEGIN");

    let customerId: number | null = null;
    if (customer_name || customer_email || customer_phone) {
      const customerResult = await client.query(
        `INSERT INTO customers (merchant_id, name, email, phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [merchantId, customer_name, customer_email, customer_phone]
      );
      customerId = customerResult.rows[0].id;
    }

    const idemKey = idempotency_key || `idem_${uuidv4().replace(/-/g, "")}`;

    const paymentResult = await client.query(
      `INSERT INTO payments (merchant_id, customer_id, idempotency_key, amount, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 'created') RETURNING *`,
      [merchantId, customerId, idemKey, amount, payment_method]
    );
    const payment = paymentResult.rows[0];

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, performed_by)
       VALUES ('payment', $1, 'created', $2, $3)`,
      [payment.id, JSON.stringify(payment), merchantId]
    );

    await client.query("COMMIT");
    res.status(201).json({ success: true, message: "Payment created", data: payment });

  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post("/capture/:id", apiKeyAuth, async (req: MerchantRequest, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const merchantId = req.merchant!.id;

    await client.query("BEGIN");

    const paymentResult = await client.query(
      "SELECT * FROM payments WHERE id = $1 AND merchant_id = $2",
      [id, merchantId]
    );
    if (paymentResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "Payment not found" });
      return;
    }

    const payment = paymentResult.rows[0];
    if (payment.status !== "created") {
      res.status(400).json({ success: false, message: `Payment cannot be captured — current status: ${payment.status}` });
      return;
    }

    const updatedPayment = await client.query(
      `UPDATE payments SET status = 'captured', captured_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    const grossAmount = parseFloat(payment.amount);
    const platformFee = parseFloat((grossAmount * 0.02).toFixed(2));
    const taxAmount = parseFloat((platformFee * 0.18).toFixed(2));
    const netAmount = parseFloat((grossAmount - platformFee - taxAmount).toFixed(2));

    await client.query(
      `INSERT INTO settlements (payment_id, merchant_id, gross_amount, platform_fee, tax_amount, net_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [id, merchantId, grossAmount, platformFee, taxAmount, netAmount]
    );

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, performed_by)
       VALUES ('payment', $1, 'captured', $2, $3, $4)`,
      [id, JSON.stringify(payment), JSON.stringify(updatedPayment.rows[0]), merchantId]
    );

    await client.query("COMMIT");
    await triggerWebhook(merchantId, "payment.captured", {
  payment_id: id,
  amount: grossAmount,
  net_amount: netAmount,
  captured_at: new Date()
});
    res.json({
      success: true,
      message: "Payment captured and settlement initiated",
      data: { payment: updatedPayment.rows[0], settlement: { grossAmount, platformFee, taxAmount, netAmount, status: "pending" } }
    });

  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get("/", protect, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const merchantId = req.merchant!.id;
    const page = parseInt(req.query.page as string || "1");
    const limit = parseInt(req.query.limit as string || "10");
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const payment_method = req.query.payment_method as string;

    let whereClause = "WHERE p.merchant_id = $1";
    const params: (string | number)[] = [merchantId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND p.status = $${paramCount}`;
      params.push(status);
    }
    if (payment_method) {
      paramCount++;
      whereClause += ` AND p.payment_method = $${paramCount}`;
      params.push(payment_method);
    }

    const totalResult = await pool.query(`SELECT COUNT(*) FROM payments p ${whereClause}`, params);
    const total = parseInt(totalResult.rows[0].count);

    const result = await pool.query(
      `SELECT p.*, c.name as customer_name FROM payments p
       LEFT JOIN customers c ON c.id = p.customer_id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: result.rows, pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalPayments: total } });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", apiKeyAuth, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const merchantId = req.merchant!.id;

    const result = await pool.query(
      `SELECT p.*, c.name as customer_name, c.email as customer_email
       FROM payments p
       LEFT JOIN customers c ON c.id = p.customer_id
       WHERE p.id = $1 AND p.merchant_id = $2`,
      [id, merchantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Payment not found" });
      return;
    }
    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/fail", apiKeyAuth, async (req: MerchantRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { failure_reason } = req.body as UpdatePaymentBody;
    const merchantId = req.merchant!.id;

    const result = await pool.query(
      `UPDATE payments SET status = 'failed', failure_reason = $1
       WHERE id = $2 AND merchant_id = $3 AND status = 'created' RETURNING *`,
      [failure_reason || "Payment failed", id, merchantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Payment not found or cannot be failed" });
      return;
    }
    res.json({ success: true, message: "Payment marked as failed", data: result.rows[0] });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

export default router;