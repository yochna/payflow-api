import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Application error with an HTTP status code. Throw it from route handlers and
 * the global error handler will serialize it for the client.
 */
export class ApiError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type RouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * error middleware instead of hanging the request.
 */
export const asyncHandler = (fn: RouteHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Central error handler. Converts ApiError instances and known PostgreSQL
 * codes into consistent JSON responses; anything else is a 500.
 */
export const globalErrorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  const pgErr = err as { code?: string } | null;
  if (pgErr?.code === "23505") {
    res.status(409).json({
      success: false,
      message: "Resource already exists",
      code: "unique_violation",
    });
    return;
  }
  if (pgErr?.code === "23503") {
    res.status(400).json({
      success: false,
      message: "Referenced resource does not exist",
      code: "foreign_key_violation",
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Server error";
  res.status(500).json({ success: false, message });
};
