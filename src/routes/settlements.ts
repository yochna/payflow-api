import { Router, Response, NextFunction } from "express";
import pool from "../config/db";
import { protect } from "../middleware/auth";
import { ApiError, asyncHandler } from "../middleware/error";
import { MerchantRequest } from "../types";
import { parsePagination, parsePositiveInt } from "../utils/validation";

const router = Router();

// GET /api/settlements
// All settlements for merchant
router.get(
  "/",
  protect,
  asyncHandler(async (req: MerchantRequest, res: Response) => {
    const merchantId = req.merchant!.id;
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit);
    const status = req.query.status as string;

    let whereClause = "WHERE s.merchant_id = $1";
    const params: (string | number)[] = [merchantId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND s.status = $${paramCount}`;
      params.push(status);
    }

    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM settlements s ${whereClause}`,
      params
    );
    const total = parseInt(totalResult.rows[0].count);

    const result = await pool.query(
      `SELECT s.*, p.payment_method, p.currency
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
       ${whereClause}
       ORDER BY s.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );
    res.json({
      success: true,
      data: result.rows,
      pagination: { currentPage: page, totalSettlements: total },
    });
  })
);

// GET /api/settlements/summary
// Aggregated settlement overview for a merchant
router.get(
  "/summary",
  protect,
  asyncHandler(async (req: MerchantRequest, res: Response) => {
    const merchantId = req.merchant!.id;

    // daily breakdown - window function + aggregations
    const dailyResult = await pool.query(
      `SELECT
         DATE(s.created_at) as date,
         COUNT(s.id) as total_settlements,
         SUM(s.gross_amount) as total_gross,
         SUM(s.platform_fee) as total_fees,
         SUM(s.tax_amount) as total_tax,
         SUM(s.net_amount) as total_net,
         COUNT(CASE WHEN s.status = 'settled' THEN 1 END) as settled_count,
         COUNT(CASE WHEN s.status = 'pending' THEN 1 END) as pending_count
       FROM settlements s
       WHERE s.merchant_id = $1
       GROUP BY DATE(s.created_at)
       ORDER BY date DESC`,
      [merchantId]
    );
    // overall summary
    const summaryResult = await pool.query(
      `SELECT
         COUNT(s.id) as total_settlements,
         SUM(s.gross_amount) as total_gross,
         SUM(s.platform_fee) as total_fees,
         SUM(s.net_amount) as total_net,
         ROUND(AVG(s.gross_amount), 2) as avg_settlement,
         MAX(s.gross_amount) as largest_settlement,
         MIN(s.gross_amount) as smallest_settlement
       FROM settlements s
       WHERE s.merchant_id = $1`,
      [merchantId]
    );
    // payment method breakdown
    const methodResult = await pool.query(
      `SELECT
         p.payment_method,
         COUNT(s.id) as count,
         SUM(s.gross_amount) as total_amount,
         ROUND(AVG(s.gross_amount), 2) as avg_amount
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
       WHERE s.merchant_id = $1
       GROUP BY p.payment_method
       ORDER BY total_amount DESC`,
      [merchantId]
    );
    res.json({
      success: true,
      data: {
        overall: summaryResult.rows[0],
        daily_breakdown: dailyResult.rows,
        by_payment_method: methodResult.rows,
      },
    });
  })
);

// POST /api/settlements/:id/settle
// Mark a pending settlement as settled
router.post(
  "/:id/settle",
  protect,
  asyncHandler(async (req: MerchantRequest, res: Response, next: NextFunction) => {
    const id = parsePositiveInt(req.params.id, "settlement id");
    const merchantId = req.merchant!.id;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE settlements
         SET status = 'settled',
             settled_at = NOW()
         WHERE id = $1
           AND merchant_id = $2
           AND status = 'pending'
         RETURNING *`,
        [id, merchantId]
      );

      if (result.rows.length === 0) {
        throw new ApiError("Settlement not found or already settled", 404);
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, performed_by)
         VALUES ('settlement', $1, 'settled', $2, $3)`,
        [id, JSON.stringify(result.rows[0]), merchantId]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Settlement marked as settled",
        data: result.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      next(err);
    } finally {
      client.release();
    }
  })
);

export default router;
