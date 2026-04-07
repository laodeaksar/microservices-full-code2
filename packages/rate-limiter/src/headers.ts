import { Request, Response } from "express";

export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

export function setRateLimitHeaders(
  res: Response,
  headers: RateLimitHeaders
): void {
  // IETF Draft headers (preferred)
  res.set("RateLimit-Limit", headers.limit.toString());
  res.set("RateLimit-Remaining", Math.max(0, headers.remaining).toString());
  res.set("RateLimit-Reset", headers.reset.toString());

  // Legacy headers (for backward compatibility)
  res.set("X-RateLimit-Limit", headers.limit.toString());
  res.set("X-RateLimit-Remaining", Math.max(0, headers.remaining).toString());
  res.set("X-RateLimit-Reset", headers.reset.toString());

  // Add Retry-After only on 429 responses
  if (headers.retryAfter && res.statusCode === 429) {
    res.set("Retry-After", headers.retryAfter.toString());
  }
}
