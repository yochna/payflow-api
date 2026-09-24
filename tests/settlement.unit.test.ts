import { describe, it, expect } from "vitest";
import {
  calculateSettlement,
  remainingAfterRefund,
  isFullyRefunded,
  round2,
  PLATFORM_FEE_RATE,
  GST_RATE,
} from "../src/services/settlement";

describe("calculateSettlement", () => {
  it("applies a 2% platform fee", () => {
    expect(PLATFORM_FEE_RATE).toBe(0.02);
    expect(calculateSettlement(1000).platformFee).toBe(20);
  });

  it("applies 18% GST on the platform fee", () => {
    expect(GST_RATE).toBe(0.18);
    expect(calculateSettlement(1000).taxAmount).toBe(3.6);
  });

  it("credits the merchant the net amount after fee and tax", () => {
    expect(calculateSettlement(1000).netAmount).toBe(976.4);
  });

  it("handles fractional amounts without floating point drift", () => {
    const s = calculateSettlement(99.99);
    expect(s.platformFee).toBe(2);
    expect(s.taxAmount).toBe(0.36);
    expect(s.netAmount).toBe(97.63);
  });

  it("leaves the gross amount untouched in the breakdown", () => {
    const s = calculateSettlement(2500.5);
    expect(s.grossAmount).toBe(2500.5);
  });

  it("zero amount produces zero fees", () => {
    expect(calculateSettlement(0)).toEqual({
      grossAmount: 0,
      platformFee: 0,
      taxAmount: 0,
      netAmount: 0,
    });
  });

  it("keeps fee, tax and net consistent with the gross", () => {
    const s = calculateSettlement(1234.56);
    expect(s.grossAmount).toBe(round2(s.platformFee + s.taxAmount + s.netAmount));
  });
});

describe("remainingAfterRefund", () => {
  it("subtracts the refund amount", () => {
    expect(remainingAfterRefund(976.4, 100)).toBe(876.4);
  });

  it("never goes below zero", () => {
    expect(remainingAfterRefund(50, 500)).toBe(0);
  });
});

describe("isFullyRefunded", () => {
  it("is true when the refund covers the remaining balance", () => {
    expect(isFullyRefunded(976.4, 976.4)).toBe(true);
    expect(isFullyRefunded(1000, 976.4)).toBe(true);
  });

  it("is false when the refund leaves a balance", () => {
    expect(isFullyRefunded(100, 976.4)).toBe(false);
  });
});
