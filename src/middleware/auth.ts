import { Request ,NextFunction , Response } from "express";
import jwt from "jsonwebtoken";
import pool from "../config/db";
import { MerchantRequest } from "../types";

interface TokenPayload{
     id: number;
  email: string;
}

// jwt auth
export const protect = async(
    req:MerchantRequest,
    res:Response,
    next:NextFunction
):Promise<void> =>{
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "No token provided" });
    return;
  }
  const token = authHeader.split(" ")[1];
  try{
    const decoded = jwt.verify(token,process.env.JWT_SECRET as string)as TokenPayload
    const result = await pool.query("SELECT * FROM merchants WHERE id = $1",[decoded.id]);

    if(result.rows.length ===0){
        res.status(401).json({ success: false, message: "Merchant not found" });
      return;
    }
    req.merchant = result.rows[0];
    next();
  }catch{
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};

// API key auth -for payment routes
export const apiKeyAuth = async(
    req:MerchantRequest,
    res:Response,
    next:NextFunction
):Promise<void> =>{
    const apiKey = req.headers["x-api-key"] as string;
    if(!apiKey){
        res.status(401).json({ success: false, message: "API key required" });
    return;
    }

    try{
        const result = await pool.query(
            "SELECT * FROM merchants WHERE api_key  = $1 AND is_active = true",
            [apiKey]
        );
        if(result.rows.length ===0){
            res.status(401).json({success:false,message :"Invalid API key"});
            return;
        }

        req.merchant = result.rows[0];
        next();
    }catch{
        res.status(500).json({success:false, message:"Server Error"});
    }
}; 