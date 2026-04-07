import { Redis } from "@upstash/redis";

// ============================================================
// Redis Client (Upstash for production, fallback to in-memory)
// ============================================================

let redis: Redis | null = null;

const getRedisClient = (): Redis | null => {
  if (!redis && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
};

// ============================================================
// In-Memory Fallback Store
// ============================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetTime < now) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ============================================================
// Rate Limit Configuration
// ============================================================

const rateLimitConfig: Record<string, { max: number; windowMs: number }> = {
  "/api/categories": { max: 100, windowMs: 60 * 1000 },
  "/api/products": { max: 100, windowMs: 60 * 1000 },
  "/api/hero-products": { max: 200, windowMs: 60 * 1000 },
};

// ============================================================
// Rate Limit Check Functions
// ============================================================

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

async function checkRateLimitRedis(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const now = Date.now();
    const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;

    const pipeline = client.pipeline();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, Math.ceil(windowMs / 1000) * 2);

    const results = await pipeline.exec<[number, number]>();
    //@ts-ignore
    const count = results?.[0]?.[1] as number;

    const remaining = Math.max(0, max - count);
    const resetTime = now + windowMs;

    return {
      allowed: count <= max,
      remaining,
      resetTime,
    };
  } catch (error) {
    console.error("[RateLimiter] Redis error:", error);
    return null;
  }
}

function checkRateLimitMemory(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetTime < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    memoryStore.set(key, newEntry);
    return {
      allowed: true,
      remaining: max - 1,
      resetTime: newEntry.resetTime,
    };
  }

  if (entry.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: max - entry.count,
    resetTime: entry.resetTime,
  };
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  // Try Redis first
  const redisResult = await checkRateLimitRedis(key, max, windowMs);
  if (redisResult) return redisResult;

  // Fallback to in-memory
  return checkRateLimitMemory(key, max, windowMs);
}
