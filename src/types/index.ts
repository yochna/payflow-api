import { Request } from "express";

export interface Merchant {
  id: number;
  name: string;
  email: string;
  api_key: string;
  api_secret: string;
  is_active: boolean;
  settlement_account?: string;
  created_at: Date;
}

export interface MerchantRequest extends Request {
  merchant?: Merchant;
}

export interface RegisterBody {
  name: string;
  email: string;
  password: string;
  settlement_account?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}