import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/db";
import { RegisterBody, LoginBody, MerchantRequest } from "../types";
import { protect } from "../middleware/auth";
import { ApiError, asyncHandler } from "../middleware/error";

const router = Router();

const generateTokens = (id: number, email: string) => {
  const accessToken = jwt.sign({ id, email }, process.env.JWT_SECRET as string, {
    expiresIn: "15m",
  });

  const refreshToken = jwt.sign({ id, email }, process.env.REFRESH_SECRET as string, {
    expiresIn: "7d",
  });
  return { accessToken, refreshToken };
};

// POST /api/auth/register
router.post(
  "/register",
  asyncHandler(async (req: Request<object, object, RegisterBody>, res: Response) => {
    const { name, email, password, settlement_account, webhook_url } = req.body;

    if (!name || !email || !password) {
      throw new ApiError("Name, email and password required", 400);
    }
    // check existing
    const existing = await pool.query("SELECT id FROM merchants WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      throw new ApiError("Email already registered", 400);
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const apiKey = `pk_${uuidv4().replace(/-/g, "")}`;
    const apiSecret = `sk_${uuidv4().replace(/-/g, "")}`;

    const result = await pool.query(
      `INSERT INTO merchants (name, email, password, api_key, api_secret, settlement_account, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, email, api_key, api_secret`,
      [name, email, hashedPassword, apiKey, apiSecret, settlement_account, webhook_url]
    );

    const merchant = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(merchant.id, merchant.email);
    res.status(201).json({
      success: true,
      data: { merchant, accessToken, refreshToken },
    });
  })
);

router.post(
  "/login",
  asyncHandler(async (req: Request<object, object, LoginBody>, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new ApiError("Email and password required", 400);
    }
    const result = await pool.query("SELECT * FROM merchants WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      throw new ApiError("Merchant not found", 404);
    }
    const merchant = result.rows[0];
    const match = await bcrypt.compare(password, merchant.password);

    if (!match) {
      throw new ApiError("Wrong password", 400);
    }
    const { accessToken, refreshToken } = generateTokens(merchant.id, merchant.email);
    res.json({
      success: true,
      data: {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          email: merchant.email,
          api_key: merchant.api_key,
        },
        accessToken,
        refreshToken,
      },
    });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req: Request<object, object, { refreshToken?: string }>, res: Response) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new ApiError("No refresh token", 401);
    }

    let decoded: { id: number; email: string };
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as {
        id: number;
        email: string;
      };
    } catch {
      throw new ApiError("Invalid refresh token", 401);
    }
    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.id, decoded.email);

    res.json({ success: true, data: { accessToken, refreshToken: newRefresh } });
  })
);

// GET /api/auth/me
router.get("/me", protect, (req: MerchantRequest, res: Response): void => {
  res.json({ success: true, data: req.merchant });
});

export default router;
