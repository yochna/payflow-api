import { Router, Response } from "express";
import pool from "../config/db";
import { protect } from "../middleware/auth";
import { MerchantRequest } from "../types";

const router = Router();

// get //api/settlements
// all settlements for merchnat

router.get("/",protect,async(req:MerchantRequest,res:Response):Promise<void>=>{
    try{
        const merchantId = req.merchant!.id;
        const page = parseInt(req.query.page as string ||"1");
        const limit = parseInt(req.query.limit as string || "10");
        const offset = (page -1)*limit;
        const status = req.query.status as string;


        let whereClause = "WHERE s.merchant_id = $1";
        const params:(string |number)[] =[merchantId];
        let paramCount =1;

        if(status){
            paramCount++;
            whereClause +=`AND s.status = $${paramCount}`;
            params.push(status);
        }

        const totalResult = await pool.query(
            `SELECT COUNT(*) FROM settlemnets s ${whereClause}`,params
        );
        const total= parseInt(totalResult.rows[0].count);

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
            success:true,
            data:result.rows,
            pagination:{currentPage:page,totalSettlements: total}
        });
    }catch(err){
           if (err instanceof Error) res.status(500).json({ success: false, message: err.message });

    }
})

 router.get("/summary",protect,async(req:MerchantRequest,res:Response):Promise<void>=>{
    try{
        const merchantId = req.merchant!.id;

        // daily breakdown - window function+aggregations
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
        )
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
        by_payment_method: methodResult.rows
      }
    });

  } catch (err) {
    if (err instanceof Error) res.status(500).json({ success: false, message: err.message });
  }
});

export default router;