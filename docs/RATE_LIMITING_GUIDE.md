# Production-Ready Rate Limiting Integration Guide

> **Purpose**: Protect all public API endpoints from abuse, ensure fair resource allocation, and maintain service stability under high load.
> 
> **Scope**: This guide covers rate limiting implementation across the entire microservices architecture including Next.js API routes, Express-based services, and API gateway configurations.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Algorithm Selection](#2-algorithm-selection)
3. [Implementation Strategy](#3-implementation-strategy)
4. [Express.js Services Implementation](#4-expressjs-services-implementation)
5. [Next.js API Routes Implementation](#5-nextjs-api-routes-implementation)
6. [API Gateway Configuration](#6-api-gateway-configuration)
7. [Rate Limit Response Headers](#7-rate-limit-response-headers)
8. [Edge Cases & Graceful Degradation](#8-edge-cases--graceful-degradation)
9. [Monitoring & Alerting](#9-monitoring--alerting)
10. [Testing Methodologies](#10-testing-methodologies)
11. [Security Considerations](#11-security-considerations)
12. [Deployment Steps](#12-deployment-steps)
13. [Troubleshooting](#13-troubleshooting)
14. [Performance Optimization](#14-performance-optimization)

---

## 1. Architecture Overview

### Current Service Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway / CDN                        │
│                   (Cloudflare / NGINX / Vercel)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
    │  Next.js Client│ │   Admin    │ │  Mobile App │
    │   (Port 3002)  │ │  (Port 3003)│ │  (Port 3004)│
    └─────────┬──────┘ └─────┬──────┘ └──────┬──────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
    ┌─────────────────────────┼─────────────────────────┐
    │                         │                         │
┌───▼──────────┐    ┌────────▼────────┐    ┌──────────▼─────────┐
│Product Service│    │  Auth Service   │    │  Order Service     │
│  (Port 8000)  │    │  (Port 8001)    │    │  (Port 8002)       │
└──────────────┘    └─────────────────┘    └────────────────────┘
                                                  │
                                    ┌─────────────┼─────────────┐
                                    │             │             │
                              ┌─────▼─────┐ ┌────▼────┐ ┌─────▼─────┐
                              │Payment Svc│ │Email Svc│ │  DB/Cache │
                              │ (Port 8003)│ │(Port 8004)│ │ (Redis)   │
                              └───────────┘ └─────────┘ └───────────┘
```

### Public Endpoints Requiring Rate Limiting

| Service | Endpoint | Method | Sensitivity | Recommended Limit |
|---------|----------|--------|-------------|-------------------|
| Product Service | `/products` | GET | Medium | 100 req/min |
| Product Service | `/products/:id` | GET | Medium | 100 req/min |
| Product Service | `/categories` | GET | Low | 200 req/min |
| Product Service | `/hero` | GET | Low | 200 req/min |
| Product Service | `/external-products/search` | GET | High | 20 req/min |
| Product Service | `/external-products/import` | POST | High | 10 req/min |
| Product Service | `/upload/*` | POST | Critical | 5 req/min |
| Auth Service | `/users/*` | Various | High | 30 req/min |
| Next.js Client | `/api/categories` | GET | Medium | 100 req/min |
| Next.js Client | `/api/products` | GET | Medium | 100 req/min |
| Next.js Client | `/api/hero-products` | GET | Low | 200 req/min |

---

## 2. Algorithm Selection

### Available Algorithms

| Algorithm | Best For | Pros | Cons | Memory Usage |
|-----------|----------|------|------|--------------|
| **Sliding Window Log** | High-precision, audit trails | Exact, supports complex queries | High memory, slower | O(n) per client |
| **Sliding Window Counter** | General API rate limiting | Good accuracy, moderate memory | Approximate at boundaries | O(1) per client |
| **Token Bucket** | Bursty traffic, smooth limiting | Allows bursts, smooth processing | Complex to implement | O(1) per client |
| **Fixed Window Counter** | Simple use cases, low memory | Simple, fast, low memory | Boundary burst vulnerability | O(1) per client |

### Recommended Algorithm by Use Case

```typescript
// Decision matrix for algorithm selection
const algorithmSelection = {
  // Public read endpoints - use Sliding Window Counter
  publicRead: "slidingWindowCounter",
  
  // Write endpoints (POST/PUT/DELETE) - use Token Bucket
  writeOperations: "tokenBucket",
  
  // Authentication endpoints - use Fixed Window (strict)
  authEndpoints: "fixedWindowCounter",
  
  // External API proxy - use Sliding Window Log (audit required)
  externalApiProxy: "slidingWindowLog",
  
  // File uploads - use Token Bucket with low rate
  fileUploads: "tokenBucket",
};
```

### Why Sliding Window Counter is Default

For this microservices architecture, **Sliding Window Counter** is recommended as the default because:

1. **Balanced accuracy**: ~50% more accurate than fixed window at boundaries
2. **Memory efficient**: O(1) storage per client using Redis
3. **Simple implementation**: Easy to understand and maintain
4. **Distributed-ready**: Works seamlessly with Redis clusters

---

## 3. Implementation Strategy

### Phase 1: Foundation (Week 1)
- [ ] Install rate limiting dependencies
- [ ] Create shared rate limiting middleware
- [ ] Implement Redis-based storage
- [ ] Add standard response headers

### Phase 2: Service Integration (Week 2)
- [ ] Integrate into Express services
- [ ] Add to Next.js middleware
- [ ] Configure per-endpoint limits
- [ ] Implement graceful degradation

### Phase 3: Monitoring & Testing (Week 3)
- [ ] Set up Prometheus metrics
- [ ] Configure alerting rules
- [ ] Write load tests
- [ ] Document runbooks

### Phase 4: Production Rollout (Week 4)
- [ ] Deploy to staging
- [ ] Run chaos tests
- [ ] Gradual production rollout
- [ ] Monitor and adjust limits

---

## 4. Express.js Services Implementation

### 4.1 Install Dependencies

```bash
# Install in each Express service
pnpm add express-rate-limit rate-limit-redis ioredis

# Or for the workspace root
pnpm add express-rate-limit rate-limit-redis ioredis --filter product-service
pnpm add express-rate-limit rate-limit-redis ioredis --filter auth-service
pnpm add express-rate-limit rate-limit-redis ioredis --filter order-service
pnpm add express-rate-limit rate-limit-redis ioredis --filter payment-service
```

### 4.2 Create Shared Rate Limiter Module

Create a shared package for rate limiting configuration:

```typescript
// packages/rate-limiter/src/index.ts
import { rateLimit, Options as RateLimitOptions } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";
import { Request, Response } from "express";

// ============================================================
// Redis Connection Configuration
// ============================================================

let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: "ratelimit:",
      retryStrategy: (times: number) => {
        if (times > 10) {
          console.error(
            "[RateLimiter] Redis connection failed after 10 retries"
          );
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000); // Exponential backoff
      },
    });

    redisClient.on("error", (err) => {
      console.error("[RateLimiter] Redis error:", err.message);
    });

    redisClient.on("connect", () => {
      console.log("[RateLimiter] Connected to Redis");
    });
  }
  return redisClient;
};

// ============================================================
// Rate Limit Configuration Presets
// ============================================================

export interface RateLimitPreset {
  windowMs: number;
  max: number;
  message: string;
  statusCode: number;
}

export const RATE_LIMIT_PRESETS: Record<string, RateLimitPreset> = {
  // Public read endpoints
  publicRead: {
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },

  // Public read endpoints (low priority)
  publicReadRelaxed: {
    windowMs: 60 * 1000,
    max: 200,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },

  // Authenticated user endpoints
  authenticated: {
    windowMs: 60 * 1000,
    max: 150,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },

  // Write operations (POST/PUT/DELETE)
  writeOperations: {
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many write requests, please try again later.",
    statusCode: 429,
  },

  // External API proxy (protects third-party quotas)
  externalApi: {
    windowMs: 60 * 1000,
    max: 20,
    message: "Rate limit exceeded for external API. Please wait before trying again.",
    statusCode: 429,
  },

  // File uploads
  fileUploads: {
    windowMs: 60 * 1000,
    max: 5,
    message: "Too many upload requests, please try again later.",
    statusCode: 429,
  },

  // Authentication endpoints (strict)
  authEndpoints: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: "Too many authentication attempts, please try again later.",
    statusCode: 429,
  },

  // Critical operations (payment, etc.)
  critical: {
    windowMs: 60 * 1000,
    max: 10,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },
};

// ============================================================
// Key Generator Functions
// ============================================================

export const generateKey = (req: Request): string => {
  // Priority: User ID > API Key > IP Address
  const userId = (req as any).userId;
  const apiKey = req.headers["x-api-key"] as string;
  const ip = req.ip || req.socket.remoteAddress;

  if (userId) return `user:${userId}`;
  if (apiKey) return `apikey:${apiKey}`;
  return `ip:${ip}`;
};

export const generateStrictIPKey = (req: Request): string => {
  // Use only IP for strict rate limiting (no user identification)
  return `ip:${req.ip || req.socket.remoteAddress}`;
};

// ============================================================
// Handler Functions
// ============================================================

export const rateLimitHandler = (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const key = generateKey(req);

  // Log rate limit violations
  console.warn(
    `[RateLimiter] Rate limit exceeded: ${key}`,
    `Path: ${req.path}`,
    `Method: ${req.method}`,
    `User: ${userId || "anonymous"}`
  );

  res.status(429).json({
    error: "Too Many Requests",
    message: req.rateLimit
      ? `Rate limit exceeded. Try again in ${Math.ceil(req.rateLimit.resetTime! - Date.now() / 1000)} seconds.`
      : "Rate limit exceeded. Please try again later.",
    retryAfter: req.rateLimit?.resetTime
      ? Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
      : 60,
    path: req.path,
  });
};

// ============================================================
// Skip Function - Bypass rate limiting for certain requests
// ============================================================

export const skipRateLimit = (req: Request): boolean => {
  // Skip in development (optional)
  if (process.env.NODE_ENV === "development" && process.env.DISABLE_RATE_LIMIT === "true") {
    return true;
  }

  // Skip health checks
  if (req.path === "/health" || req.path === "/ready") {
    return true;
  }

  // Skip internal service-to-service calls (with valid internal token)
  const internalToken = req.headers["x-internal-token"];
  if (internalToken === process.env.INTERNAL_SERVICE_TOKEN) {
    return true;
  }

  // Skip for admin users (optional - use with caution)
  const userRole = (req as any).userRole;
  if (userRole === "superadmin" && process.env.SKIP_RATE_LIMIT_FOR_ADMINS === "true") {
    return true;
  }

  return false;
};

// ============================================================
// Factory Function - Create rate limiters
// ============================================================

export interface CreateRateLimiterOptions {
  preset: keyof typeof RATE_LIMIT_PRESETS;
  customOptions?: Partial<RateLimitOptions>;
  useRedis?: boolean;
}

export const createRateLimiter = (options: CreateRateLimiterOptions) => {
  const preset = RATE_LIMIT_PRESETS[options.preset];
  const useRedis = options.useRedis !== false && process.env.REDIS_HOST;

  const baseConfig: RateLimitOptions = {
    windowMs: preset.windowMs,
    max: preset.max,
    message: {
      error: "Too Many Requests",
      message: preset.message,
    },
    statusCode: preset.statusCode,
    keyGenerator: generateKey,
    handler: rateLimitHandler,
    skip: skipRateLimit,
    standardHeaders: true, // Send RateLimit-* headers
    legacyHeaders: false, // Disable X-RateLimit-* headers
    requestWasSuccessful: (req, res) => res.statusCode < 400,

    // Trust proxy for accurate IP behind reverse proxy
    trustProxy: true,
  };

  if (useRedis) {
    baseConfig.store = new RedisStore({
      sendCommand: (...args: string[]) => getRedisClient().call(...args),
      prefix: "ratelimit:",
    });
  }

  return rateLimit({
    ...baseConfig,
    ...options.customOptions,
  });
};

// ============================================================
// Pre-configured Rate Limiters
// ============================================================

export const rateLimiters = {
  publicRead: createRateLimiter({ preset: "publicRead" }),
  publicReadRelaxed: createRateLimiter({ preset: "publicReadRelaxed" }),
  authenticated: createRateLimiter({ preset: "authenticated" }),
  writeOperations: createRateLimiter({ preset: "writeOperations" }),
  externalApi: createRateLimiter({ preset: "externalApi" }),
  fileUploads: createRateLimiter({ preset: "fileUploads" }),
  authEndpoints: createRateLimiter({ preset: "authEndpoints" }),
  critical: createRateLimiter({ preset: "critical" }),
};

export default rateLimiters;
```

### 4.3 Package Configuration

```json
// packages/rate-limiter/package.json
{
  "name": "@repo/rate-limiter",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "express-rate-limit": "^7.1.5",
    "rate-limit-redis": "^4.2.0",
    "ioredis": "^5.3.2"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "express": "^5.0.0"
  }
}
```

### 4.4 Integration into Product Service

```typescript
// apps/product-service/src/index.ts (updated)
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { rateLimiters } from "@repo/rate-limiter";
import productRouter from "./routes/product.route";
import categoryRouter from "./routes/category.route";
import heroRouter from "./routes/hero.route";
import uploadRouter from "./routes/upload.route";
import externalProductRouter from "./routes/externalProduct.route";

const app = express();

// ... existing CORS and middleware setup ...

// ============================================================
// Rate Limiting - Apply BEFORE routes
// ============================================================

// Global rate limiter (catch-all, most permissive)
app.use(rateLimiters.publicReadRelaxed);

// Health endpoints - no rate limiting (handled by skip function)
app.get("/health", (req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Apply specific rate limiters to route groups
app.use("/products", rateLimiters.publicRead, productRouter);
app.use("/categories", rateLimiters.publicReadRelaxed, categoryRouter);
app.use("/hero", rateLimiters.publicReadRelaxed, heroRouter);
app.use("/upload", rateLimiters.fileUploads, uploadRouter);
app.use("/external-products", rateLimiters.externalApi, externalProductRouter);

// ... error handling and server start ...
```

### 4.5 Per-Route Rate Limiting

```typescript
// apps/product-service/src/routes/product.route.ts (updated)
import { Router } from "express";
import { rateLimiters, createRateLimiter } from "@repo/rate-limiter";
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  updateProduct,
  getHeroProducts,
} from "../controllers/product.controller";
import { shouldBeAdmin } from "../middleware/authMiddleware";

const router: Router = Router();

// Write operations - stricter limits
router.post("/", rateLimiters.writeOperations, createProduct);
router.put("/:id", shouldBeAdmin, rateLimiters.writeOperations, updateProduct);
router.delete("/:id", shouldBeAdmin, rateLimiters.writeOperations, deleteProduct);

// Read operations - more permissive
router.get("/hero", rateLimiters.publicReadRelaxed, getHeroProducts);
router.get("/", rateLimiters.publicRead, getProducts);

// Individual product lookup - moderate limits
router.get(
  "/:id",
  createRateLimiter({
    preset: "publicRead",
    customOptions: {
      // Generate key based on product ID to prevent single-product scraping
      keyGenerator: (req) => {
        const userId = (req as any).userId;
        const productId = req.params.id;
        return userId ? `user:${userId}:product:${productId}` : `ip:${req.ip}:product:${productId}`;
      },
      max: 50, // Lower limit for individual product access
    },
  }),
  getProduct
);

export default router;
```

### 4.6 Integration into Auth Service

```typescript
// apps/auth-service/src/index.ts (updated)
import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { rateLimiters, createRateLimiter } from "@repo/rate-limiter";
import userRouter from "./routes/user.route";

const app = express();

app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

// Auth endpoints - strict rate limiting to prevent brute force
app.use(
  "/users/auth",
  createRateLimiter({
    preset: "authEndpoints",
    customOptions: {
      keyGenerator: (req) => `ip:${req.ip}`, // IP-only for auth
      message: {
        error: "Too Many Authentication Attempts",
        message: "Too many authentication attempts. Please wait 15 minutes before trying again.",
      },
    },
  })
);

// General user endpoints
app.use("/users", rateLimiters.authenticated, userRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
```

---

## 5. Next.js API Routes Implementation

### 5.1 Middleware-Based Rate Limiting

Update the existing middleware to include rate limiting:

```typescript
// apps/client/src/middleware.ts (updated)
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ============================================================
// In-Memory Rate Limit Store (for edge-compatible rate limiting)
// For production, use Redis via Upstash or similar
// ============================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ============================================================
// Rate Limit Configuration
// ============================================================

const rateLimitConfig = {
  "/api/categories": { max: 100, windowMs: 60 * 1000 },
  "/api/products": { max: 100, windowMs: 60 * 1000 },
  "/api/hero-products": { max: 200, windowMs: 60 * 1000 },
  "/api/cart": { max: 50, windowMs: 60 * 1000 },
  "/api/orders": { max: 30, windowMs: 60 * 1000 },
};

function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    // New window
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitStore.set(key, newEntry);
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

// ============================================================
// Middleware
// ============================================================

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // Check rate limiting for API routes
  for (const [prefix, config] of Object.entries(rateLimitConfig)) {
    if (pathname.startsWith(prefix)) {
      // Generate rate limit key
      const userId = (await auth()).userId;
      const rateLimitKey = userId
        ? `user:${userId}:${prefix}`
        : `ip:${request.ip}:${prefix}`;

      const result = checkRateLimit(rateLimitKey, config.max, config.windowMs);

      // Create response with rate limit headers
      const response = NextResponse.next();

      response.headers.set("X-RateLimit-Limit", config.max.toString());
      response.headers.set("X-RateLimit-Remaining", result.remaining.toString());
      response.headers.set(
        "X-RateLimit-Reset",
        Math.ceil(result.resetTime / 1000).toString()
      );

      if (!result.allowed) {
        return new NextResponse(
          JSON.stringify({
            error: "Too Many Requests",
            message: "Rate limit exceeded. Please try again later.",
            retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
              "X-RateLimit-Limit": config.max.toString(),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
            },
          }
        );
      }

      // Continue with other middleware logic
      const finalResponse = NextResponse.next();

      // Add rate limit headers to successful responses
      finalResponse.headers.set("X-RateLimit-Limit", config.max.toString());
      finalResponse.headers.set("X-RateLimit-Remaining", result.remaining.toString());
      finalResponse.headers.set(
        "X-RateLimit-Reset",
        Math.ceil(result.resetTime / 1000).toString()
      );

      // Add security headers
      finalResponse.headers.set("X-Content-Type-Options", "nosniff");
      finalResponse.headers.set("X-Frame-Options", "DENY");
      finalResponse.headers.set("X-XSS-Protection", "1; mode=block");
      finalResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      finalResponse.headers.set("X-DNS-Prefetch-Control", "on");

      // Cache static assets
      if (
        pathname.startsWith("/_next/static/") ||
        pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|avif|ico|woff|woff2|ttf|eot)$/i)
      ) {
        finalResponse.headers.set(
          "Cache-Control",
          "public, max-age=31536000, immutable"
        );
      }

      return finalResponse;
    }
  }

  // Non-API routes - add security headers only
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "on");

  return response;
}, {
  debug: process.env.NODE_ENV === "development",
  signInUrl: "/sign-in",
  signUpUrl: "/sign-up",
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

### 5.2 Redis-Based Rate Limiting with Upstash (Production)

For production Next.js deployments, use Upstash Redis for distributed rate limiting:

```typescript
// apps/client/src/lib/rate-limiter.ts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export async function rateLimit(
  key: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const redisKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;

  // Use Redis pipeline for atomic operations
  const pipeline = redis.pipeline();
  pipeline.incr(redisKey);
  pipeline.expire(redisKey, windowSeconds * 2); // Double expiry for sliding window

  const [count] = await pipeline.exec<[number, number]>();

  const currentCount = count as number;
  const remaining = Math.max(0, limit - currentCount);
  const reset = Math.ceil((now + windowSeconds * 1000) / 1000);

  if (currentCount > limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      reset,
    };
  }

  return {
    success: true,
    limit,
    remaining,
    reset,
  };
}

// Usage in API route
// apps/client/src/app/api/products/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limiter";

export async function GET(request: Request) {
  const { userId } = await auth();
  const key = userId ? `user:${userId}:products` : `ip:${request.headers.get("x-forwarded-for")}:products`;

  const result = await rateLimit(key, 100, 60);

  const headers = new Headers();
  headers.set("X-RateLimit-Limit", result.limit.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set("X-RateLimit-Reset", result.reset.toString());

  if (!result.success) {
    headers.set("Retry-After", "60");
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: 60,
      },
      { status: 429, headers }
    );
  }

  // ... existing product fetch logic ...
}
```

---

## 6. API Gateway Configuration

### 6.1 NGINX Rate Limiting

```nginx
# /etc/nginx/nginx.conf

http {
    # ============================================================
    # Rate Limiting Zones
    # ============================================================
    
    # Zone for general API requests - 10MB shared memory, 10 req/s per IP
    limit_req_zone $binary_remote_addr zone=api_general:10m rate=10r/s;
    
    # Zone for authentication - stricter, 1 req/s per IP
    limit_req_zone $binary_remote_addr zone=api_auth:10m rate=1r/s;
    
    # Zone for external API proxy - 2 req/s per IP
    limit_req_zone $binary_remote_addr zone=api_external:10m rate=2r/s;
    
    # Zone for uploads - 1 req/s per IP
    limit_req_zone $binary_remote_addr zone=api_upload:10m rate=1r/s;
    
    # Zone based on API key header (if available)
    limit_req_zone $http_x_api_key zone=api_key:10m rate=50r/s;
    
    # ============================================================
    # Rate Limit Status Codes
    # ============================================================
    limit_req_status 429;
    limit_req_log_level warn;
    
    # ============================================================
    # Custom Error Page for 429
    # ============================================================
    error_page 429 /429.json;
    
    location = /429.json {
        internal;
        default_type application/json;
        return 429 '{
            "error": "Too Many Requests",
            "message": "Rate limit exceeded. Please try again later.",
            "retryAfter": 60
        }';
    }
    
    server {
        listen 80;
        server_name api.neuraltale.com;
        
        # ============================================================
        # General API Endpoints
        # ============================================================
        location /api/products {
            limit_req zone=api_general burst=20 nodelay;
            limit_req_status 429;
            
            # Add rate limit headers
            add_header X-RateLimit-Limit 600;
            add_header X-RateLimit-Remaining $limit_req_status;
            
            proxy_pass http://product_service;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
        
        location /api/categories {
            limit_req zone=api_general burst=30 nodelay;
            proxy_pass http://product_service;
        }
        
        # ============================================================
        # Authentication Endpoints (Strict)
        # ============================================================
        location /api/auth {
            limit_req zone=api_auth burst=5 nodelay;
            proxy_pass http://auth_service;
        }
        
        # ============================================================
        # External API Proxy (Strict)
        # ============================================================
        location /api/external-products {
            limit_req zone=api_external burst=10 nodelay;
            proxy_pass http://product_service;
        }
        
        # ============================================================
        # Upload Endpoints (Very Strict)
        # ============================================================
        location /api/upload {
            limit_req zone=api_upload burst=2 nodelay;
            client_max_body_size 10m;
            proxy_pass http://product_service;
        }
        
        # ============================================================
        # Health Check (No Rate Limiting)
        # ============================================================
        location /health {
            proxy_pass http://product_service;
        }
    }
}
```

### 6.2 Cloudflare Rate Limiting

```yaml
# Cloudflare Rate Limiting Rules (via Terraform or Dashboard)

# Rule 1: General API Protection
resource "cloudflare_rate_limit" "api_general" {
  zone_id = var.cloudflare_zone_id
  
  threshold = 1000
  period    = 60
  
  match {
    request {
      url_pattern   = "api.neuraltale.com/*"
      schemes       = ["HTTPS"]
      methods       = ["GET", "POST", "PUT", "DELETE"]
    }
  }
  
  action {
    mode     = "simulate"  # Change to "ban" for production
    timeout  = 3600        # 1 hour ban
    response {
      content_type = "application/json"
      body         = jsonencode({
        error   = "Too Many Requests"
        message = "Rate limit exceeded. Please try again later."
      })
    }
  }
  
  correlate {
    by = "nat"
  }
}

# Rule 2: Authentication Protection (Strict)
resource "cloudflare_rate_limit" "api_auth" {
  zone_id = var.cloudflare_zone_id
  
  threshold = 10
  period    = 60
  
  match {
    request {
      url_pattern = "api.neuraltale.com/auth/*"
      methods     = ["POST"]
    }
  }
  
  action {
    mode    = "ban"
    timeout = 86400  # 24 hour ban
  }
}

# Rule 3: Bot Protection
resource "cloudflare_rate_limit" "bot_protection" {
  zone_id = var.cloudflare_zone_id
  
  threshold = 50
  period    = 60
  
  match {
    request {
      url_pattern = "api.neuraltale.com/*"
    }
    response {
      statuses = [401, 403, 404]
    }
  }
  
  action {
    mode    = "ban"
    timeout = 3600
  }
}
```

### 6.3 Kong API Gateway Configuration

```yaml
# kong.yml

_format_version: "3.0"

services:
  - name: product-service
    url: http://product-service:8000
    routes:
      - name: products-route
        paths:
          - /api/products
        plugins:
          - name: rate-limiting
            config:
              minute: 100
              policy: redis
              redis:
                host: redis
                port: 6379
              limit_by: consumer
              fault_tolerant: true
              hide_client_headers: false
          
          - name: rate-limiting-advanced
            config:
              limit:
                - 100
              window_size:
                - 60
              strategy: redis
              redis:
                host: redis
                port: 6379
              identifier: consumer
              sync_rate: 10
              namespace: ratelimit_products
              
      - name: categories-route
        paths:
          - /api/categories
        plugins:
          - name: rate-limiting
            config:
              minute: 200
              policy: redis

  - name: auth-service
    url: http://auth-service:8001
    routes:
      - name: auth-route
        paths:
          - /api/auth
        plugins:
          - name: rate-limiting
            config:
              minute: 10
              policy: redis
              limit_by: ip

plugins:
  - name: rate-limiting
    config:
      minute: 1000
      policy: redis
      redis:
        host: redis
        port: 6379
```

---

## 7. Rate Limit Response Headers

### 7.1 Standard Headers (RFC 7231 / Draft)

All rate-limited responses should include these headers:

```
# Standard Rate Limit Headers (IETF Draft)
RateLimit-Limit: 100
RateLimit-Remaining: 42
RateLimit-Reset: 1712246400

# Legacy Headers (for backward compatibility)
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1712246400

# Retry-After (only on 429 responses)
Retry-After: 38
```

### 7.2 Header Implementation

```typescript
// packages/rate-limiter/src/headers.ts
import { Request, Response } from "express";

export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
  retryAfter?: number; // Seconds until reset (only for 429)
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

// Express rate-limit middleware automatically adds these headers
// when standardHeaders: true is set in configuration
```

### 7.3 Response Body for 429

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again in 38 seconds.",
  "retryAfter": 38,
  "path": "/api/products",
  "documentation": "https://docs.neuraltale.com/rate-limits"
}
```

---

## 8. Edge Cases & Graceful Degradation

### 8.1 Redis Failure Handling

```typescript
// packages/rate-limiter/src/fallback.ts
import { rateLimit, Options } from "express-rate-limit";
import { Request, Response, NextFunction } from "express";

// In-memory fallback store
const memoryStore = new Map<string, { count: number; resetTime: number }>();

// Cleanup interval
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

    // Handle Redis errors gracefully
    skipFailedRequests: false,

    // Custom error handler
    handler: (req: Request, res: Response) => {
      if (useFallback) {
        console.warn(
          "[RateLimiter] Using in-memory fallback - rate limits may be inaccurate"
        );
      }

      res.status(options.statusCode || 429).json({
        error: "Too Many Requests",
        message: options.message as string,
        retryAfter: req.rateLimit?.resetTime
          ? Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
          : 60,
        fallback: useFallback,
      });
    },
  });
};
```

### 8.2 Handling Proxied IPs

```typescript
// apps/product-service/src/index.ts
import express from "express";

const app = express();

// Trust proxy - essential for accurate IP detection behind load balancers
// Set to the number of proxy hops in your infrastructure
app.set("trust proxy", 2); // Adjust based on your setup

// Or use specific trusted proxies
// app.set('trust proxy', '127.0.0.1, 10.0.0.0/8');

// Custom key generator that handles X-Forwarded-For
const generateKeyWithProxy = (req: Request): string => {
  // Express automatically parses X-Forwarded-For when trust proxy is set
  const ip = req.ip;
  const userId = (req as any).userId;
  const apiKey = req.headers["x-api-key"] as string;

  if (userId) return `user:${userId}`;
  if (apiKey) return `apikey:${apiKey}`;
  return `ip:${ip}`;
};
```

### 8.3 Burst Handling

```typescript
// Token bucket implementation for burst-friendly rate limiting
import { RateLimiterRedis } from "rate-limiter-flexible";
import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
});

export const tokenBucketLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "token_bucket",
  points: 100, // Total tokens
  duration: 60, // Refill period in seconds
  execEvenly: true, // Smooth out request processing
  blockDuration: 0, // Don't block, just reject
});

// Usage with burst allowance
export const handleWithBurst = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const key = req.ip || "unknown";
    await tokenBucketLimiter.consume(key);
    next();
  } catch (rejRes: any) {
    res.set("Retry-After", Math.ceil(rejRes.msBeforeNext / 1000).toString());
    res.status(429).json({
      error: "Too Many Requests",
      message: "Rate limit exceeded",
      retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
    });
  }
};
```

### 8.4 User Tier Support

```typescript
// packages/rate-limiter/src/tiers.ts
import { Request } from "express";

export interface UserTier {
  name: string;
  multiplier: number;
  maxRequests: number;
}

export const USER_TIERS: Record<string, UserTier> = {
  free: { name: "free", multiplier: 1, maxRequests: 100 },
  pro: { name: "pro", multiplier: 5, maxRequests: 500 },
  enterprise: { name: "enterprise", multiplier: 20, maxRequests: 2000 },
  internal: { name: "internal", multiplier: 100, maxRequests: 10000 },
};

export const getUserTier = async (req: Request): Promise<UserTier> => {
  // Check API key tier
  const apiKey = req.headers["x-api-key"] as string;
  if (apiKey) {
    const tier = await getTierFromApiKey(apiKey);
    if (tier) return tier;
  }

  // Check user subscription tier
  const userId = (req as any).userId;
  if (userId) {
    const tier = await getTierFromUserId(userId);
    if (tier) return tier;
  }

  // Default to free tier
  return USER_TIERS.free;
};

export const createTieredRateLimiter = (baseLimiter: any) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const tier = await getUserTier(req);
    
    // Adjust rate limit based on tier
    const adjustedMax = Math.floor(baseLimiter.max * tier.multiplier);
    
    // Create a new limiter with adjusted limits
    const tieredLimiter = rateLimit({
      ...baseLimiter,
      max: adjustedMax,
      keyGenerator: (req) => `${tier.name}:${generateKey(req)}`,
    });

    return tieredLimiter(req, res, next);
  };
};
```

---

## 9. Monitoring & Alerting

### 9.1 Prometheus Metrics

```typescript
// packages/rate-limiter/src/metrics.ts
import { Request, Response, NextFunction } from "express";
import client from "prom-client";

// Create a Registry
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
const rateLimitTotal = new client.Counter({
  name: "ratelimit_total_requests",
  help: "Total number of rate-limited requests",
  labelNames: ["endpoint", "method", "status"],
});

const rateLimitRejected = new client.Counter({
  name: "ratelimit_rejected_requests",
  help: "Number of requests rejected by rate limiting",
  labelNames: ["endpoint", "method", "client_type"],
});

const rateLimitRemaining = new client.Histogram({
  name: "ratelimit_remaining_requests",
  help: "Distribution of remaining requests in rate limit window",
  labelNames: ["endpoint"],
  buckets: [0, 1, 5, 10, 20, 50, 100],
});

const rateLimitResetTime = new client.Gauge({
  name: "ratelimit_reset_time_seconds",
  help: "Time until rate limit resets",
  labelNames: ["endpoint"],
});

register.registerMetric(rateLimitTotal);
register.registerMetric(rateLimitRejected);
register.registerMetric(rateLimitRemaining);
register.registerMetric(rateLimitResetTime);

// Metrics middleware
export const rateLimitMetrics = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const endpoint = req.path;
  const method = req.method;

  // Track response
  res.on("finish", () => {
    rateLimitTotal.inc({
      endpoint,
      method,
      status: res.statusCode.toString(),
    });

    if (res.statusCode === 429) {
      const clientType = (req as any).userId ? "authenticated" : "anonymous";
      rateLimitRejected.inc({
        endpoint,
        method,
        client_type: clientType,
      });
    }

    // Track remaining requests
    if (req.rateLimit) {
      rateLimitRemaining.observe(
        { endpoint },
        req.rateLimit.remaining
      );

      const resetSeconds = Math.ceil(
        (req.rateLimit.resetTime!.getTime() - Date.now()) / 1000
      );
      rateLimitResetTime.set({ endpoint }, resetSeconds);
    }
  });

  next();
};

// Metrics endpoint
export const metricsHandler = async (
  req: Request,
  res: Response
) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
};
```

### 9.2 Grafana Dashboard

```json
{
  "dashboard": {
    "title": "Rate Limiting Dashboard",
    "panels": [
      {
        "title": "Requests per Second",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ratelimit_total_requests[5m])",
            "legendFormat": "{{endpoint}} - {{status}}"
          }
        ]
      },
      {
        "title": "Rejected Requests",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ratelimit_rejected_requests[5m])",
            "legendFormat": "{{endpoint}} - {{client_type}}"
          }
        ]
      },
      {
        "title": "Rate Limit Utilization",
        "type": "gauge",
        "targets": [
          {
            "expr": "ratelimit_remaining_requests",
            "legendFormat": "{{endpoint}}"
          }
        ]
      },
      {
        "title": "Top Rate Limited Endpoints",
        "type": "table",
        "targets": [
          {
            "expr": "topk(10, sum by(endpoint) (rate(ratelimit_rejected_requests[5m])))",
            "legendFormat": "{{endpoint}}"
          }
        ]
      }
    ]
  }
}
```

### 9.3 Alerting Rules (Prometheus)

```yaml
# alerting-rules.yml
groups:
  - name: rate-limiting
    rules:
      # High rejection rate
      - alert: HighRateLimitRejectionRate
        expr: |
          sum(rate(ratelimit_rejected_requests[5m])) by (endpoint)
          /
          sum(rate(ratelimit_total_requests[5m])) by (endpoint)
          > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High rate limit rejection rate on {{ $labels.endpoint }}"
          description: "More than 10% of requests to {{ $labels.endpoint }} are being rate limited"

      # Sudden spike in rate limiting
      - alert: RateLimitSpike
        expr: |
          sum(rate(ratelimit_rejected_requests[5m]))
          >
          sum(rate(ratelimit_rejected_requests[1h])) * 3
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Sudden spike in rate limit rejections"
          description: "Rate limit rejections have tripled compared to the hourly average"

      # Redis connection issues
      - alert: RateLimitRedisDown
        expr: |
          redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis instance used for rate limiting is down"
          description: "Rate limiting has fallen back to in-memory storage"

      # Rate limit too restrictive
      - alert: RateLimitTooRestrictive
        expr: |
          sum(rate(ratelimit_rejected_requests[1h])) by (endpoint)
          > 100
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Rate limit may be too restrictive on {{ $labels.endpoint }}"
          description: "Over 100 requests rejected per hour on {{ $labels.endpoint }}"
```

### 9.4 Structured Logging

```typescript
// packages/rate-limiter/src/logger.ts
import winston from "winston";

export const rateLimitLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "rate-limiter" },
  transports: [
    new winston.transports.File({ filename: "ratelimit-error.log", level: "error" }),
    new winston.transports.File({ filename: "ratelimit-combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  rateLimitLogger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

// Usage in rate limit handler
export const logRateLimitEvent = (
  event: "exceeded" | "reset" | "error",
  data: Record<string, any>
) => {
  switch (event) {
    case "exceeded":
      rateLimitLogger.warn("Rate limit exceeded", {
        event,
        ...data,
      });
      break;
    case "reset":
      rateLimitLogger.info("Rate limit window reset", {
        event,
        ...data,
      });
      break;
    case "error":
      rateLimitLogger.error("Rate limiter error", {
        event,
        ...data,
      });
      break;
  }
};
```

---

## 10. Testing Methodologies

### 10.1 Unit Tests

```typescript
// packages/rate-limiter/src/__tests__/rate-limiter.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRateLimiter, RATE_LIMIT_PRESETS } from "../index";
import express from "express";
import request from "supertest";

describe("Rate Limiter", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
  });

  afterEach(() => {
    // Clean up any test data
  });

  it("should allow requests within limit", async () => {
    app.use(
      createRateLimiter({
        preset: "publicRead",
        customOptions: { max: 5, windowMs: 60000 },
      })
    );
    app.get("/test", (req, res) => res.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const response = await request(app).get("/test");
      expect(response.status).toBe(200);
    }
  });

  it("should reject requests exceeding limit", async () => {
    app.use(
      createRateLimiter({
        preset: "publicRead",
        customOptions: { max: 3, windowMs: 60000 },
      })
    );
    app.get("/test", (req, res) => res.json({ ok: true }));

    // Make 3 successful requests
    for (let i = 0; i < 3; i++) {
      await request(app).get("/test");
    }

    // 4th request should be rejected
    const response = await request(app).get("/test");
    expect(response.status).toBe(429);
    expect(response.body.error).toBe("Too Many Requests");
  });

  it("should include rate limit headers", async () => {
    app.use(
      createRateLimiter({
        preset: "publicRead",
        customOptions: { max: 10, windowMs: 60000 },
      })
    );
    app.get("/test", (req, res) => res.json({ ok: true }));

    const response = await request(app).get("/test");

    expect(response.headers["ratelimit-limit"]).toBe("10");
    expect(response.headers["ratelimit-remaining"]).toBe("9");
    expect(response.headers["ratelimit-reset"]).toBeDefined();
  });

  it("should reset after window expires", async () => {
    app.use(
      createRateLimiter({
        preset: "publicRead",
        customOptions: { max: 2, windowMs: 1000 }, // 1 second window
      })
    );
    app.get("/test", (req, res) => res.json({ ok: true }));

    // Exhaust limit
    await request(app).get("/test");
    await request(app).get("/test");

    // Should be rejected
    let response = await request(app).get("/test");
    expect(response.status).toBe(429);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should be allowed again
    response = await request(app).get("/test");
    expect(response.status).toBe(200);
  });

  it("should skip health check endpoints", async () => {
    app.use(createRateLimiter({ preset: "publicRead" }));
    app.get("/health", (req, res) => res.json({ status: "ok" }));

    // Make many requests to health endpoint
    for (let i = 0; i < 200; i++) {
      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
    }
  });
});
```

### 10.2 Load Testing with k6

```javascript
// tests/load/rate-limit-test.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Custom metrics
const rateLimitHitRate = new Rate("rate_limit_hits");

export const options = {
  stages: [
    { duration: "30s", target: 50 },   // Ramp up to 50 users
    { duration: "1m", target: 200 },   // Ramp up to 200 users
    { duration: "2m", target: 200 },   // Stay at 200 users
    { duration: "30s", target: 500 },  // Spike to 500 users
    { duration: "1m", target: 500 },   // Stay at 500 users
    { duration: "30s", target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],  // 95% of requests should be below 500ms
    http_req_failed: ["rate<0.05"],    // Error rate should be below 5%
    rate_limit_hits: ["rate<0.5"],     // Rate limit hits should be below 50%
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";

export default function () {
  // Test products endpoint
  const productsRes = http.get(`${BASE_URL}/products`);
  
  check(productsRes, {
    "products status is 200 or 429": (r) => r.status === 200 || r.status === 429,
    "products has rate limit headers": (r) => r.headers["RateLimit-Limit"] !== undefined,
  });

  if (productsRes.status === 429) {
    rateLimitHitRate.add(true);
  } else {
    rateLimitHitRate.add(false);
  }

  // Test categories endpoint
  const categoriesRes = http.get(`${BASE_URL}/categories`);
  check(categoriesRes, {
    "categories status is 200 or 429": (r) => r.status === 200 || r.status === 429,
  });

  // Test individual product endpoint
  const productId = Math.floor(Math.random() * 100) + 1;
  const productRes = http.get(`${BASE_URL}/products/${productId}`);
  check(productRes, {
    "product status is 200, 404, or 429": (r) => 
      r.status === 200 || r.status === 404 || r.status === 429,
  });

  sleep(1);
}

// Run with: k6 run --env BASE_URL=http://localhost:8000 tests/load/rate-limit-test.js
```

### 10.3 Integration Tests

```typescript
// apps/product-service/src/__tests__/rate-limit.integration.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { rateLimiters } from "@repo/rate-limiter";

describe("Rate Limiting Integration", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    
    // Apply rate limiters
    app.use("/products", rateLimiters.publicRead);
    app.use("/categories", rateLimiters.publicReadRelaxed);
    app.use("/external-products", rateLimiters.externalApi);
    
    // Mock routes
    app.get("/products", (req, res) => res.json([]));
    app.get("/categories", (req, res) => res.json([]));
    app.get("/external-products/search", (req, res) => res.json({ results: [] }));
  });

  it("should apply different limits to different endpoints", async () => {
    // Products should allow 100 requests
    for (let i = 0; i < 100; i++) {
      const res = await request(app).get("/products");
      expect(res.status).toBe(200);
    }
    
    // 101st request should be rejected
    const productsRejected = await request(app).get("/products");
    expect(productsRejected.status).toBe(429);

    // Categories should still work (higher limit)
    const categoriesRes = await request(app).get("/categories");
    expect(categoriesRes.status).toBe(200);
  });

  it("should handle concurrent requests correctly", async () => {
    const promises = Array(150)
      .fill(null)
      .map(() => request(app).get("/products"));

    const responses = await Promise.all(promises);

    const successCount = responses.filter((r) => r.status === 200).length;
    const rejectedCount = responses.filter((r) => r.status === 429).length;

    expect(successCount).toBeLessThanOrEqual(100);
    expect(rejectedCount).toBeGreaterThanOrEqual(50);
  });
});
```

---

## 11. Security Considerations

### 11.1 IP Spoofing Prevention

```typescript
// apps/product-service/src/index.ts
import express from "express";

const app = express();

// Configure trust proxy based on your infrastructure
// Option 1: Trust all proxies (only if behind a trusted load balancer)
app.set("trust proxy", true);

// Option 2: Trust specific number of hops
app.set("trust proxy", 2);

// Option 3: Trust specific IP ranges
app.set("trust proxy", "127.0.0.1, 10.0.0.0/8, 172.16.0.0/12");

// Custom IP extraction with validation
const getSafeIP = (req: express.Request): string => {
  // When trust proxy is set, Express uses X-Forwarded-For correctly
  const ip = req.ip;
  
  // Validate IP format
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i;
  
  if (ipv4Regex.test(ip) || ipv6Regex.test(ip)) {
    return ip;
  }
  
  // Fallback to socket address
  return req.socket.remoteAddress || "unknown";
};
```

### 11.2 Rate Limit Bypass Prevention

```typescript
// packages/rate-limiter/src/security.ts
import { Request } from "express";

// Prevent common bypass techniques
export const securityMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 1. Detect and block requests with suspicious headers
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = (forwardedFor as string).split(",").map((ip) => ip.trim());
    
    // Block if too many IPs (potential spoofing)
    if (ips.length > 10) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid X-Forwarded-For header",
      });
    }
  }

  // 2. Detect rapid IP changes (potential proxy rotation)
  const currentIP = req.ip;
  const sessionIP = (req as any).sessionIP;
  
  if (sessionIP && sessionIP !== currentIP) {
    console.warn(`[Security] IP changed from ${sessionIP} to ${currentIP}`);
    // Optionally block or apply stricter limits
  }
  
  (req as any).sessionIP = currentIP;

  // 3. Detect automated scanning patterns
  const userAgent = req.headers["user-agent"] || "";
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /scanner/i,
    /python-requests/i,
    /curl\//i,
    /wget\//i,
  ];

  if (suspiciousPatterns.some((pattern) => pattern.test(userAgent))) {
    // Apply stricter rate limiting for suspicious user agents
    (req as any).isSuspicious = true;
  }

  next();
};

// Suspicious user agent rate limiter
export const suspiciousUserAgentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // Much lower limit for suspicious agents
  keyGenerator: (req) => `suspicious:${req.ip}`,
  skip: (req) => !(req as any).isSuspicious,
});
```

### 11.3 DDoS Protection

```yaml
# Cloudflare DDoS Protection Settings
# Configure in Cloudflare Dashboard or via Terraform

# Under Attack Mode (enable during attacks)
under_attack_mode:
  enabled: false  # Enable manually during attacks
  challenge_ttl: 3600

# Bot Fight Mode
bot_fight_mode:
  enabled: true

# Browser Integrity Check
browser_integrity_check:
  enabled: true

# Security Level
security_level: "medium"  # Options: off, low, medium, high, under_attack

# WAF Rules for API Protection
waf_rules:
  - rule: "Managed Rules - OWASP Core Ruleset"
    action: "block"
    enabled: true
    
  - rule: "Rate Limiting - Global"
    threshold: 1000
    period: 60
    action: "challenge"
    
  - rule: "Rate Limiting - Login"
    path: "/api/auth/*"
    threshold: 10
    period: 60
    action: "block"
```

### 11.4 API Key Management

```typescript
// packages/rate-limiter/src/api-keys.ts
import crypto from "crypto";

export interface APIKey {
  id: string;
  key: string;
  tier: "free" | "pro" | "enterprise";
  createdAt: Date;
  lastUsed: Date;
  rateLimit: number;
}

// Generate secure API key
export const generateAPIKey = (): string => {
  return `nt_${crypto.randomBytes(32).toString("hex")}`;
};

// Hash API key for storage
export const hashAPIKey = (key: string): string => {
  return crypto.createHash("sha256").update(key).digest("hex");
};

// Validate API key format
export const validateAPIKeyFormat = (key: string): boolean => {
  return /^nt_[a-f0-9]{64}$/.test(key);
};

// Rate limit middleware with API key
export const apiKeyRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.headers["x-api-key"] as string;

  if (apiKey) {
    if (!validateAPIKeyFormat(apiKey)) {
      return res.status(401).json({
        error: "Invalid API Key Format",
        message: "API keys must start with 'nt_' followed by 64 hex characters",
      });
    }

    const hashedKey = hashAPIKey(apiKey);
    const keyData = await getAPIKeyFromDatabase(hashedKey);

    if (!keyData) {
      return res.status(401).json({
        error: "Invalid API Key",
        message: "The provided API key is not valid",
      });
    }

    // Update last used
    await updateAPIKeyLastUsed(keyData.id);

    // Apply tier-specific rate limiting
    (req as any).apiKeyTier = keyData.tier;
    (req as any).apiKeyId = keyData.id;
  }

  next();
};
```

---

## 12. Deployment Steps

### 12.1 Pre-Deployment Checklist

```markdown
## Rate Limiting Deployment Checklist

### Infrastructure
- [ ] Redis cluster deployed and accessible
- [ ] Redis connection strings configured in all services
- [ ] Load balancer trust proxy configured
- [ ] Cloudflare rate limiting rules configured (if applicable)

### Application
- [ ] @repo/rate-limiter package installed in all services
- [ ] Rate limiting middleware added to Express apps
- [ ] Next.js middleware updated with rate limiting
- [ ] Per-endpoint rate limits configured
- [ ] Graceful degradation implemented

### Monitoring
- [ ] Prometheus metrics endpoint exposed
- [ ] Grafana dashboard imported
- [ ] Alerting rules configured
- [ ] Log aggregation configured

### Testing
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Load tests executed
- [ ] Chaos tests completed

### Documentation
- [ ] API documentation updated with rate limits
- [ ] Runbook created for rate limit incidents
- [ ] Developer guide published
```

### 12.2 Deployment Commands

```bash
# 1. Deploy Redis (if not already deployed)
# Using Docker Compose
docker-compose up -d redis

# Using Kubernetes
kubectl apply -f k8s/redis/

# 2. Build and deploy rate limiter package
cd packages/rate-limiter
pnpm build
pnpm publish

# 3. Update services
cd ../..
pnpm install

# 4. Deploy services one by one
# Product Service
cd apps/product-service
pnpm build
docker build -t neuraltale/product-service:latest .
docker push neuraltale/product-service:latest
kubectl rollout restart deployment/product-service

# Auth Service
cd ../auth-service
pnpm build
docker build -t neuraltale/auth-service:latest .
docker push neuraltale/auth-service:latest
kubectl rollout restart deployment/auth-service

# Client (Next.js)
cd ../client
pnpm build
docker build -t neuraltale/client:latest .
docker push neuraltale/client:latest
kubectl rollout restart deployment/client

# 5. Verify deployment
kubectl get pods
kubectl logs -f deployment/product-service | grep "RateLimiter"

# 6. Run smoke tests
curl -I http://localhost:8000/products
curl -I http://localhost:8000/categories
curl -I http://localhost:3002/api/products
```

### 12.3 Environment Variables

```bash
# .env for all services

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-secure-password
REDIS_DB=0

# Rate Limiting Configuration
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_FOR_ADMINS=false
DISABLE_RATE_LIMIT=false  # Development only

# Internal Service Communication
INTERNAL_SERVICE_TOKEN=your-internal-token-here

# Proxy Configuration
TRUST_PROXY=true
TRUST_PROXY_HOPS=2
```

---

## 13. Troubleshooting

### 13.1 Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| Redis Connection Failed | Rate limiting falls back to memory | Check Redis connection, verify credentials |
| All Requests Blocked | 429 on every request | Check `trust proxy` setting, verify IP extraction |
| Rate Limit Not Working | No 429 responses | Verify middleware order, check Redis store |
| Inconsistent Limits | Different limits per instance | Ensure Redis is used, not memory store |
| False Positives | Legitimate users blocked | Review limits, check for shared IPs (NAT) |

### 13.2 Debug Commands

```bash
# Check Redis connection
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD ping

# View rate limit keys in Redis
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD keys "ratelimit:*"

# Get specific rate limit data
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD get "ratelimit:ip:192.168.1.1"

# Clear all rate limits (emergency)
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD keys "ratelimit:*" | xargs redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD del

# Check service logs
kubectl logs -f deployment/product-service --tail=100 | grep -i "ratelimit"

# Test rate limiting locally
for i in {1..150}; do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/products
  echo ""
done
```

### 13.3 Emergency Procedures

```bash
# Emergency: Disable rate limiting temporarily
# Set environment variable and restart service
kubectl set env deployment/product-service DISABLE_RATE_LIMIT=true
kubectl rollout restart deployment/product-service

# Emergency: Increase rate limits
kubectl set env deployment/product-service RATE_LIMIT_MAX_REQUESTS=500
kubectl rollout restart deployment/product-service

# Emergency: Clear all rate limits
kubectl exec -it redis-0 -- redis-cli FLUSHDB

# Emergency: Block abusive IP
kubectl exec -it redis-0 -- redis-cli SET "block:ip:1.2.3.4" "1" EX 3600
```

### 13.4 Runbook: Rate Limit Incident

```markdown
# Runbook: Rate Limit Incident Response

## Severity Levels

### P1 - Widespread Blocking
**Symptom**: >50% of legitimate users receiving 429 errors

**Actions**:
1. Immediately increase rate limits:
   ```bash
   kubectl set env deployment/product-service RATE_LIMIT_MAX_REQUESTS=1000
   ```
2. Check for DDoS attack:
   ```bash
   # Check request patterns
   kubectl logs deployment/product-service | grep "Rate limit exceeded" | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20
   ```
3. If DDoS confirmed, enable Cloudflare Under Attack Mode
4. Notify team in #incidents channel

### P2 - Elevated Rejection Rate
**Symptom**: 10-50% rejection rate increase

**Actions**:
1. Review Grafana dashboard for patterns
2. Check if specific endpoint is affected
3. Consider increasing limits for affected endpoint
4. Monitor for 30 minutes

### P3 - Minor Issues
**Symptom**: Isolated 429 errors, <10% rejection rate

**Actions**:
1. Document the incident
2. Review rate limit configuration
3. Adjust limits if needed in next deployment

## Post-Incident
1. Conduct post-mortem
2. Update rate limit configuration if needed
3. Update this runbook with learnings
```

---

## 14. Performance Optimization

### 14.1 Redis Optimization

```typescript
// packages/rate-limiter/src/redis-optimization.ts
import Redis from "ioredis";

// Connection pooling
export const createOptimizedRedis = () => {
  return new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    
    // Connection pool settings
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 5) {
        return null; // Stop retrying
      }
      return Math.min(times * 50, 1000); // Faster backoff
    },
    
    // Keep-alive for better performance
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    
    // Lazy connect (only when needed)
    lazyConnect: true,
    
    // Key prefix for organization
    keyPrefix: "ratelimit:",
    
    // Pipeline batching
    maxLoadingRetryTime: 5000,
  });
};

// Use Redis pipelines for batch operations
export const pipelineRateCheck = async (
  redis: Redis,
  keys: string[],
  windowMs: number
) => {
  const pipeline = redis.pipeline();
  
  keys.forEach((key) => {
    pipeline.incr(key);
    pipeline.expire(key, Math.ceil(windowMs / 1000));
  });
  
  return pipeline.exec();
};
```

### 14.2 Memory Optimization

```typescript
// packages/rate-limiter/src/memory-optimization.ts

// LRU Cache for frequently accessed rate limit data
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Global LRU cache for rate limit data
export const rateLimitCache = new LRUCache<string, number>(10000);
```

### 14.3 Response Time Optimization

```typescript
// packages/rate-limiter/src/performance.ts
import { Request, Response, NextFunction } from "express";

// Performance tracking middleware
export const rateLimitPerformance = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1_000_000; // Convert to ms

    // Log slow rate limit checks
    if (duration > 50) {
      console.warn(
        `[Performance] Slow rate limit check: ${duration.toFixed(2)}ms`,
        `Path: ${req.path}`,
        `Method: ${req.method}`
      );
    }
  });

  next();
};
```

### 14.4 Benchmarking

```typescript
// packages/rate-limiter/src/__benchmarks__/rate-limiter.bench.ts
import { Bench } from "tinybench";
import { createRateLimiter } from "../index";

const bench = new Bench({ time: 1000 });

// Benchmark different rate limiter configurations
bench
  .add("Memory Store - 100 req/min", async () => {
    const limiter = createRateLimiter({
      preset: "publicRead",
      useRedis: false,
    });
    // Simulate request
  })
  .add("Redis Store - 100 req/min", async () => {
    const limiter = createRateLimiter({
      preset: "publicRead",
      useRedis: true,
    });
    // Simulate request
  })
  .add("Memory Store - 1000 concurrent", async () => {
    // Simulate 1000 concurrent requests
  })
  .add("Redis Store - 1000 concurrent", async () => {
    // Simulate 1000 concurrent requests
  });

await bench.run();

console.table(bench.table());
```

---

## Appendix A: Complete Endpoint Configuration

```typescript
// packages/rate-limiter/src/config.ts
// Complete rate limit configuration for all endpoints

export const endpointRateLimits: Record<string, RateLimitConfig> = {
  // Product Service
  "GET /products": { windowMs: 60000, max: 100, tier: "publicRead" },
  "GET /products/:id": { windowMs: 60000, max: 100, tier: "publicRead" },
  "POST /products": { windowMs: 60000, max: 30, tier: "writeOperations" },
  "PUT /products/:id": { windowMs: 60000, max: 30, tier: "writeOperations" },
  "DELETE /products/:id": { windowMs: 60000, max: 10, tier: "writeOperations" },
  
  "GET /categories": { windowMs: 60000, max: 200, tier: "publicReadRelaxed" },
  
  "GET /hero": { windowMs: 60000, max: 200, tier: "publicReadRelaxed" },
  
  "POST /upload": { windowMs: 60000, max: 5, tier: "fileUploads" },
  
  "GET /external-products/search": { windowMs: 60000, max: 20, tier: "externalApi" },
  "POST /external-products/import": { windowMs: 60000, max: 10, tier: "externalApi" },
  "GET /external-products/details/:source/:id": { windowMs: 60000, max: 30, tier: "externalApi" },
  
  // Auth Service
  "POST /users/auth/*": { windowMs: 900000, max: 10, tier: "authEndpoints" },
  "GET /users/*": { windowMs: 60000, max: 150, tier: "authenticated" },
  
  // Next.js API Routes
  "GET /api/categories": { windowMs: 60000, max: 100, tier: "publicRead" },
  "GET /api/products": { windowMs: 60000, max: 100, tier: "publicRead" },
  "GET /api/hero-products": { windowMs: 60000, max: 200, tier: "publicReadRelaxed" },
};
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│                    RATE LIMITING QUICK REFERENCE                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ALGORITHMS:                                                    │
│  • Sliding Window Counter (default) - Balanced accuracy/memory  │
│  • Token Bucket - Burst-friendly                                │
│  • Fixed Window - Simple, strict                                │
│                                                                 │
│  DEFAULT LIMITS:                                                │
│  • Public Read: 100 req/min                                     │
│  • Public Read (relaxed): 200 req/min                           │
│  • Write Operations: 30 req/min                                 │
│  • External API: 20 req/min                                     │
│  • File Uploads: 5 req/min                                      │
│  • Auth Endpoints: 10 req/15min                                 │
│                                                                 │
│  RESPONSE CODES:                                                │
│  • 200 - Success                                                │
│  • 429 - Too Many Requests                                      │
│                                                                 │
│  HEADERS:                                                       │
│  • RateLimit-Limit: Maximum requests allowed                    │
│  • RateLimit-Remaining: Requests remaining                      │
│  • RateLimit-Reset: Unix timestamp when limit resets            │
│  • Retry-After: Seconds to wait (only on 429)                   │
│                                                                 │
│  EMERGENCY COMMANDS:                                            │
│  • Disable: kubectl set env deployment/X DISABLE_RATE_LIMIT=true│
│  • Increase: kubectl set env deployment/X RATE_LIMIT_MAX=500    │
│  • Clear: redis-cli keys "ratelimit:*" | xargs redis-cli del    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Environment-Specific Configuration

```typescript
// packages/rate-limiter/src/environments.ts

export const environmentConfig = {
  development: {
    enabled: process.env.DISABLE_RATE_LIMIT !== "true",
    useRedis: false,
    logLevel: "debug",
    // More permissive in development
    multipliers: {
      publicRead: 5,
      writeOperations: 3,
      externalApi: 3,
    },
  },
  
  staging: {
    enabled: true,
    useRedis: true,
    logLevel: "info",
    // Production-like limits
    multipliers: {
      publicRead: 2,
      writeOperations: 1.5,
      externalApi: 1.5,
    },
  },
  
  production: {
    enabled: true,
    useRedis: true,
    logLevel: "warn",
    multipliers: {
      publicRead: 1,
      writeOperations: 1,
      externalApi: 1,
    },
  },
};

export const getCurrentConfig = () => {
  const env = process.env.NODE_ENV || "development";
  return environmentConfig[env as keyof typeof environmentConfig];
};
```

---

*Last Updated: 2026-04-04*
*Version: 1.0.0*
*Maintainer: Platform Engineering Team*
