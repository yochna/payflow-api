/**
 * Pure settlement/refund math, kept free of framework and DB dependencies so
 * it can be unit-tested directly.
 */
export const PLATFORM_FEE_RATE = 0.02;
export const GST_RATE = 0.18;

export interface SettlementBreakdown {
  grossAmount: number;
  platformFee: number;
  taxAmount: number;
  netAmount: number;
}

/**
 * Rounds to two decimals (rupees/paisa-style money precision).
 * Uses Number.EPSILON to avoid floating point drift (e.g. 976.399999→976.4).
 */
export const round2 = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

/**
 * Splits a captured payment into platform fee (2%), GST on the fee (18%) and
 * the net amount credited to the merchant settlement.
 */
export const calculateSettlement = (grossAmount: number): SettlementBreakdown => {
  const gross = Number(grossAmount);
  const platformFee = round2(gross * PLATFORM_FEE_RATE);
  const taxAmount = round2(platformFee * GST_RATE);
  const netAmount = round2(gross - platformFee - taxAmount);
  return { grossAmount: gross, platformFee, taxAmount, netAmount };
};

/**
 * Remaining refundable balance after a refund (never below zero).
 */
export const remainingAfterRefund = (remaining: number, refundAmount: number): number => {
  return Math.max(round2(remaining - refundAmount), 0);
};

/**
 * A refund that covers the full remaining balance fully refunds the payment;
 * anything less leaves it partially refunded.
 */
export const isFullyRefunded = (refundAmount: number, remaining: number): boolean =>
  refundAmount >= remaining;
