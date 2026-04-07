import { rateLimit, Options } from "express-rate-limit";
import { Request, Response, NextFunction } from "express";

// In-memory fallback store
const memoryStore = new Map<string, { count: number; resetTime: number }>();

// Cleanup interval - runs every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetTime < now) {
      memoryStore.delete(key);
    }
  }
}, 60 * 1000);

export const createFallbackStore = () => {
  return {
    async increment(key: string, windowMs: number) {
      const now = Date.now();
      let entry = memoryStore.get(key);

      if (!entry || entry.resetTime < now) {
        entry = { count: 0, resetTime: now + windowMs };
      }

      entry.count++;
      memoryStore.set(key, entry);

      return {
        totalHits: entry.count,
        resetTime: entry.resetTime,
      };
    },

    async decrement(key: string) {
      const entry = memoryStore.get(key);
      if (entry) {
        entry.count = Math.max(0, entry.count - 1);
      }
    },

    async resetKey(key: string) {
      memoryStore.delete(key);
    },
  };
};

// Graceful degradation wrapper
export const createResilientRateLimiter = (
  options: Options,
  redisStore: any
) => {
  const fallbackStore = createFallbackStore();
  let useFallback = false;

  // Test Redis connection on startup
  redisStore.client?.ping?.().catch(() => {
    console.warn("[RateLimiter] Redis unavailable, using in-memory store");
    useFallback = true;
  });

  return rateLimit({
    ...options,
    store: useFallback ? fallbackStore : redisStore,

    handler: (req: Request, res: Response) => {
      if (useFallback) {
        console.warn(
          "[RateLimiter] Using in-memory fallback - rate limits may be inaccurate"
        );
      }

      res.status(options.statusCode || 429).json({
        error: "Too Many Requests",
        message: options.message as string,
        //@ts-ignore
        retryAfter: req.rateLimit?.resetTime
        //@ts-ignore
          ? Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
          : 60,
        fallback: useFallback,
      });
    },
  });
};
