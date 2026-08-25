import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/db";
import { RegisterBody, LoginBody, MerchantRequest } from "../types";
import { apiKeyAuth, protect } from "../middleware/auth";

const router = Router();

const generateTokens = (id: number, email: string) => {
  const accessToken = jwt.sign(
    { id, email },
    process.env.JWT_SECRET as string,
    { expiresIn: "15m" },
  );

  const refreshToken = jwt.sign(
    { id, email },
    process.env.REFRESH_SECRET as string,
    { expiresIn: "7d" },
  );
  return { accessToken, refreshToken };
};

// POST /API/AUTH/register
router.post(
  "/register",
  async (req: Request<{}, {}, RegisterBody>, res: Response): Promise<void> => {
    try {
      const { name, email, password, settlement_account } = req.body;

      if (!name || !email || !password) {
        res
          .status(400)
          .json({
            success: false,
            message: "Name, email and password required",
          });
        return;
      }
      // check existing
      const existing = await pool.query(
        "SELECT id FROM merchants WHERE email = $1",
        [email],
      );
      if (existing.rows.length > 0) {
        res
          .status(400)
          .json({ success: false, message: "Email already registered" });
        return;
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      const apiKey = `pk_${uuidv4().replace(/-/g, "")}`;
      const apiSecret = `sk_${uuidv4().replace(/-/g, "")}`;

      const result = await pool.query(
        `INSERT INTO merchants (name, email, password, api_key, api_secret, settlement_account)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, api_key, api_secret`,
        [name, email, hashedPassword, apiKey, apiSecret, settlement_account],
      );

      const merchant = result.rows[0];
      const { accessToken, refreshToken } = generateTokens(
        merchant.id,
        merchant.email,
      );
      res.status(201).json({
        success: true,
        data: { merchant, accessToken, refreshToken },
      });
    } catch (err) {
      if (err instanceof Error)
        res.status(500).json({ success: false, message: err.message });
    }
  },
);

router.post("/login",async(req:Request<{},{},LoginBody>,res:Response):Promise<void> =>{
    try{
        const{email,password} = req.body;
        if(!email||!password){
             res.status(400).json({ success: false, message: "Email and password required" });
      return;
        }
        const result = await pool.query("SELECT *FROM merchants WHERE email = $1",[email]);
        if(result.rows.length ===0){
               res.status(404).json({ success: false, message: "Merchant not found" });
      return;
        }
        const merchant = result.rows[0];
        const match = await bcrypt.compare(password,merchant.password);

        if(!match){
            res.status(400).json({ success: false, message: "Wrong password" });
      return;
        }
        const{accessToken,refreshToken} = generateTokens(merchant.id, merchant.email);
         res.json({
      success: true,
      data: {
        merchant: { id: merchant.id, name: merchant.name, email: merchant.email, api_key: merchant.api_key },
        accessToken,
        refreshToken
      }
    });
    }catch (err) {
    if (err instanceof Error)
      res.status(500).json({ success: false, message: err.message });
  }
})


router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(401).json({ success: false, message: "No refresh token" });
      return;
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as { id: number; email: string };
   const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.id, decoded.email);

    res.json({ success: true, data: { accessToken, refreshToken: newRefresh } });

  } catch {
    res.status(401).json({ success: false, message: "Invalid refresh token" });
  }
});

// GET /api/auth/me
router.get("/me", protect, (req: MerchantRequest, res: Response): void => {
  res.json({ success: true, data: req.merchant });
});

export default router;
