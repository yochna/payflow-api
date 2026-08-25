import { Request } from "express";

export interface Merchant{
     id: number;
  name: string;
  email: string;
  api_key: string;
  api_secret: string;
  is_active: boolean;
  settlement_account?: string;
  created_at: Date;
}

export interface Payment{
     id: number;
  merchant_id: number;
  customer_id?: number;
  idempotency_key?: string;
  amount: number;
  currency: string;
  status: "created" | "processing" | "captured" | "failed" | "refunded" | "partially_refunded";
  failure_reason?: string;
  payment_method: "upi" | "card" | "netbanking" | "wallet";
  created_at: Date;
  captured_at?: Date;
}

export interface Settlement{
     id: number;
  payment_id: number;
  merchant_id: number;
  gross_amount: number;
  platform_fee: number;
  tax_amount: number;
  net_amount: number;
  status: "pending" | "processing" | "settled" | "failed";
  settled_at?: Date;
}

export interface MerchantRequest extends Request{
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