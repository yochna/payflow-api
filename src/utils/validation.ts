import { ApiError } from "../middleware/error";

export const MAX_AMOUNT = 100_000_000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/**
 * Validates money at the API boundary: finite, positive, within a sane cap and
 * with at most two decimal places. Returns a rounded value safe for DECIMAL.
 */
export const parseAmount = (value: unknown, field = "amount"): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(`${field} must be a finite number`, 400);
  }
  if (value <= 0 || value > MAX_AMOUNT) {
    throw new ApiError(`${field} must be greater than 0 and at most ${MAX_AMOUNT}`, 400);
  }
  const cents = value * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-6) {
    throw new ApiError(`${field} must have at most 2 decimal places`, 400);
  }
  return Math.round(cents) / 100;
};

export const parseIdempotencyKey = (bodyKey: unknown, headerKey: unknown): string | null => {
  const raw = typeof bodyKey === "string" && bodyKey.trim() ? bodyKey : headerKey;
  if (typeof raw !== "string" || !raw.trim()) return null;

  const key = raw.trim();
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError(
      `idempotency key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      400
    );
  }
  return key;
};

export const parsePagination = (pageValue: unknown, limitValue: unknown, maxLimit = 100) => {
  const page = Math.max(Number.parseInt(String(pageValue ?? "1"), 10) || 1, 1);
  const limit = Math.min(
    Math.max(Number.parseInt(String(limitValue ?? "10"), 10) || 10, 1),
    maxLimit
  );
  return { page, limit, offset: (page - 1) * limit };
};

export const parsePositiveInt = (value: unknown, field: string): number => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(`${field} must be a positive integer`, 400);
  }
  return parsed;
};
