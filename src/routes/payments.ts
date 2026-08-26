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

/**
 * CREATE PAYMENT
 * POST /api/payments/create
 */
router.post(
  "/create",
  apiKeyAuth,
  async (req: MerchantRequest, res: Response): Promise<void> => {
    const client = await pool.connect();

    try {
      const {
        amount,
        payment_method,
        customer_name,
        customer_email,
        customer_phone,
        idempotency_key,
      } = req.body as CreatePaymentBody;

      const merchantId = req.merchant!.id;

      // Validate required fields
      if (!amount || !payment_method) {
        res.status(400).json({
          success: false,
          message: "Amount and payment_method required",
        });
        return;
      }

      // Validate amount
      if (amount <= 0) {
        res.status(400).json({
          success: false,
          message: "Amount must be greater than 0",
        });
        return;
      }

      // Validate payment method
      const validMethods = ["upi", "card", "netbanking", "wallet"];

      if (!validMethods.includes(payment_method)) {
        res.status(400).json({
          success: false,
          message: "Invalid payment method",
        });
        return;
      }

      /*
       * Fast idempotency check.
       *
       * This handles the normal case where the same request
       * is sent again after the first request has completed.
       */
      if (idempotency_key) {
        const existing = await client.query(
          `SELECT *
           FROM payments
           WHERE idempotency_key = $1
           AND merchant_id = $2`,
          [idempotency_key, merchantId]
        );

        if (existing.rows.length > 0) {
          res.status(200).json({
            success: true,
            message: "Payment already exists (idempotent response)",
            data: existing.rows[0],
          });
          return;
        }
      }

      await client.query("BEGIN");

      let customerId: number | null = null;

      // Create customer only when customer information is supplied
      if (customer_name || customer_email || customer_phone) {
        const customerResult = await client.query(
          `INSERT INTO customers
            (merchant_id, name, email, phone)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [merchantId, customer_name, customer_email, customer_phone]
        );

        customerId = customerResult.rows[0].id;
      }

      /*
       * If the client doesn't provide an idempotency key,
       * generate an internal unique key.
       */
      const idemKey =
        idempotency_key ||
        `idem_${uuidv4().replace(/-/g, "")}`;

      // Create payment
      const paymentResult = await client.query(
        `INSERT INTO payments
          (
            merchant_id,
            customer_id,
            idempotency_key,
            amount,
            payment_method,
            status
          )
         VALUES ($1, $2, $3, $4, $5, 'created')
         RETURNING *`,
        [
          merchantId,
          customerId,
          idemKey,
          amount,
          payment_method,
        ]
      );

      const payment = paymentResult.rows[0];

      // Create audit log
      await client.query(
        `INSERT INTO audit_logs
          (
            entity_type,
            entity_id,
            action,
            new_value,
            performed_by
          )
         VALUES ('payment', $1, 'created', $2, $3)`,
        [
          payment.id,
          JSON.stringify(payment),
          merchantId,
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Payment created",
        data: payment,
      });
    } catch (err: any) {
      /*
       * Roll back the transaction if anything fails.
       */
      await client.query("ROLLBACK");

      /*
       * PostgreSQL error code 23505 = unique_violation.
       *
       * This handles a race condition where two requests
       * with the same idempotency key arrive simultaneously.
       */
      if (
        err.code === "23505" &&
        err.constraint?.toLowerCase().includes("idempotency")
      ) {
        const { idempotency_key } =
          req.body as CreatePaymentBody;

        const merchantId = req.merchant!.id;

        if (idempotency_key) {
          const existing = await pool.query(
            `SELECT *
             FROM payments
             WHERE idempotency_key = $1
             AND merchant_id = $2`,
            [idempotency_key, merchantId]
          );

          if (existing.rows.length > 0) {
            res.status(200).json({
              success: true,
              message:
                "Payment already exists (idempotent response)",
              data: existing.rows[0],
            });
            return;
          }
        }
      }

      if (err instanceof Error) {
        res.status(500).json({
          success: false,
          message: err.message,
        });
      }
    } finally {
      client.release();
    }
  }
);

/**
 * CAPTURE PAYMENT
 * POST /api/payments/capture/:id
 */
router.post(
  "/capture/:id",
  apiKeyAuth,
  async (req: MerchantRequest, res: Response): Promise<void> => {
    const client = await pool.connect();

    try {
      const { id } = req.params;
      const merchantId = req.merchant!.id;

      await client.query("BEGIN");

      const paymentResult = await client.query(
        `SELECT *
         FROM payments
         WHERE id = $1
         AND merchant_id = $2`,
        [id, merchantId]
      );

      // Payment not found
      if (paymentResult.rows.length === 0) {
        await client.query("ROLLBACK");

        res.status(404).json({
          success: false,
          message: "Payment not found",
        });

        return;
      }

      const payment = paymentResult.rows[0];

      // Payment must be in created state
      if (payment.status !== "created") {
        await client.query("ROLLBACK");

        res.status(400).json({
          success: false,
          message: `Payment cannot be captured — current status: ${payment.status}`,
        });

        return;
      }

      // Capture payment
      const updatedPayment = await client.query(
        `UPDATE payments
         SET status = 'captured',
             captured_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      /*
       * Settlement calculation
       *
       * Platform fee = 2%
       * GST = 18% of platform fee
       */
      const grossAmount = parseFloat(payment.amount);

      const platformFee = parseFloat(
        (grossAmount * 0.02).toFixed(2)
      );

      const taxAmount = parseFloat(
        (platformFee * 0.18).toFixed(2)
      );

      const netAmount = parseFloat(
        (grossAmount - platformFee - taxAmount).toFixed(2)
      );

      // Create settlement
      await client.query(
        `INSERT INTO settlements
          (
            payment_id,
            merchant_id,
            gross_amount,
            platform_fee,
            tax_amount,
            net_amount,
            status
          )
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [
          id,
          merchantId,
          grossAmount,
          platformFee,
          taxAmount,
          netAmount,
        ]
      );

      // Create audit log
      await client.query(
        `INSERT INTO audit_logs
          (
            entity_type,
            entity_id,
            action,
            old_value,
            new_value,
            performed_by
          )
         VALUES ('payment', $1, 'captured', $2, $3, $4)`,
        [
          id,
          JSON.stringify(payment),
          JSON.stringify(updatedPayment.rows[0]),
          merchantId,
        ]
      );

      await client.query("COMMIT");

      /*
       * Trigger webhook only after the transaction
       * has successfully committed.
       */
      await triggerWebhook(
        merchantId,
        "payment.captured",
        {
          payment_id: id,
          amount: grossAmount,
          net_amount: netAmount,
          captured_at: new Date(),
        }
      );

      res.json({
        success: true,
        message:
          "Payment captured and settlement initiated",
        data: {
          payment: updatedPayment.rows[0],
          settlement: {
            grossAmount,
            platformFee,
            taxAmount,
            netAmount,
            status: "pending",
          },
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");

      if (err instanceof Error) {
        res.status(500).json({
          success: false,
          message: err.message,
        });
      }
    } finally {
      client.release();
    }
  }
);

/**
 * GET ALL PAYMENTS
 * GET /api/payments
 */
router.get(
  "/",
  protect,
  async (req: MerchantRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;

      const page = Math.max(
        parseInt(req.query.page as string || "1", 10),
        1
      );

      const limit = Math.min(
        Math.max(
          parseInt(req.query.limit as string || "10", 10),
          1
        ),
        100
      );

      const offset = (page - 1) * limit;

      const status = req.query.status as string;
      const payment_method =
        req.query.payment_method as string;

      let whereClause =
        "WHERE p.merchant_id = $1";

      const params: (string | number)[] = [
        merchantId,
      ];

      let paramCount = 1;

      // Filter by status
      if (status) {
        paramCount++;

        whereClause +=
          ` AND p.status = $${paramCount}`;

        params.push(status);
      }

      // Filter by payment method
      if (payment_method) {
        paramCount++;

        whereClause +=
          ` AND p.payment_method = $${paramCount}`;

        params.push(payment_method);
      }

      // Count total payments
      const totalResult = await pool.query(
        `SELECT COUNT(*)
         FROM payments p
         ${whereClause}`,
        params
      );

      const total = parseInt(
        totalResult.rows[0].count,
        10
      );

      // Fetch payments
      const result = await pool.query(
        `SELECT
           p.*,
           c.name AS customer_name
         FROM payments p
         LEFT JOIN customers c
           ON c.id = p.customer_id
         ${whereClause}
         ORDER BY p.created_at DESC
         LIMIT $${paramCount + 1}
         OFFSET $${paramCount + 2}`,
        [
          ...params,
          limit,
          offset,
        ]
      );

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          currentPage: page,
          totalPages:
            total === 0
              ? 0
              : Math.ceil(total / limit),
          totalPayments: total,
        },
      });
    } catch (err) {
      if (err instanceof Error) {
        res.status(500).json({
          success: false,
          message: err.message,
        });
      }
    }
  }
);

/**
 * GET SINGLE PAYMENT
 * GET /api/payments/:id
 */
router.get(
  "/:id",
  apiKeyAuth,
  async (req: MerchantRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const merchantId = req.merchant!.id;

      const result = await pool.query(
        `SELECT
           p.*,
           c.name AS customer_name,
           c.email AS customer_email
         FROM payments p
         LEFT JOIN customers c
           ON c.id = p.customer_id
         WHERE p.id = $1
         AND p.merchant_id = $2`,
        [id, merchantId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          message: "Payment not found",
        });

        return;
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (err) {
      if (err instanceof Error) {
        res.status(500).json({
          success: false,
          message: err.message,
        });
      }
    }
  }
);

/**
 * MARK PAYMENT AS FAILED
 * POST /api/payments/:id/fail
 */
router.post(
  "/:id/fail",
  apiKeyAuth,
  async (req: MerchantRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const {
        failure_reason,
      } = req.body as UpdatePaymentBody;

      const merchantId = req.merchant!.id;

      const result = await pool.query(
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $1
         WHERE id = $2
         AND merchant_id = $3
         AND status = 'created'
         RETURNING *`,
        [
          failure_reason || "Payment failed",
          id,
          merchantId,
        ]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          message:
            "Payment not found or cannot be failed",
        });

        return;
      }

      res.json({
        success: true,
        message: "Payment marked as failed",
        data: result.rows[0],
      });
    } catch (err) {
      if (err instanceof Error) {
        res.status(500).json({
          success: false,
          message: err.message,
        });
      }
    }
  }
);

export default router;