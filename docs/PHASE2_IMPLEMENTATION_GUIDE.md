# Phase 2: Rate Limiting Service Integration - Step-by-Step Implementation Guide

> **Purpose**: This guide provides a detailed, executable implementation plan for Phase 2 of the rate limiting system as specified in [`RATE_LIMITING_GUIDE.md`](docs/RATE_LIMITING_GUIDE.md:1).
>
> **Scope**: Integration of the `@repo/rate-limiter` package into all Express services (Product Service, Auth Service), Next.js API routes (Client, Admin), and configuration of per-endpoint rate limits with graceful degradation.
>
> **Prerequisite**: Phase 1 must be completed — the `@repo/rate-limiter` package must exist, build successfully, and be accessible via workspace references.
>
> **Estimated Duration**: 1 week
>
> **Target Environment**: Production-ready microservices with pnpm workspaces, Express.js services on ports 8000/8001, and Next.js applications on ports 3002/3003.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1: Integrate Rate Limiter into Product Service](#2-step-1-integrate-rate-limiter-into-product-service)
3. [Step 2: Integrate Rate Limiter into Auth Service](#3-step-2-integrate-rate-limiter-into-auth-service)
4. [Step 3: Configure Per-Route Rate Limiting](#4-step-3-configure-per-route-rate-limiting)
5. [Step 4: Implement Next.js Client Middleware Rate Limiting](#5-step-4-implement-nextjs-client-middleware-rate-limiting)
6. [Step 5: Implement Next.js Admin Middleware Rate Limiting](#6-step-5-implement-nextjs-admin-middleware-rate-limiting)
7. [Step 6: Implement Graceful Degradation](#7-step-6-implement-graceful-degradation)
8. [Verification Procedures](#8-verification-procedures)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### 1.1 Phase 1 Completion Verification

Confirm all Phase 1 deliverables are in place before proceeding:

```bash
# Verify @repo/rate-limiter package exists and builds
cd packages/rate-limiter
pnpm build
ls dist/
# Expected: index.js, index.d.ts, and any other compiled files
```

```bash
# Verify Redis is accessible
redis-cli ping
# Expected: PONG
```

```bash
# Verify workspace references resolve
cd /home/user/microservices-full-code2
pnpm list --filter @repo/rate-limiter
# Expected: express-rate-limit, rate-limit-redis, ioredis listed
```

### 1.2 Current Service State

Review the current state of services that will be modified:

| Service | File | Current State |
|---------|------|---------------|
| Product Service | [`apps/product-service/src/index.ts`](apps/product-service/src/index.ts:1) | No rate limiting middleware |
| Auth Service | [`apps/auth-service/src/index.ts`](apps/auth-service/src/index.ts:1) | No rate limiting middleware |
| Client App | [`apps/client/src/middleware.ts`](apps/client/src/middleware.ts:1) | Security headers only, no rate limiting |
| Admin App | [`apps/admin/src/middleware.ts`](apps/admin/src/middleware.ts:1) | Existing middleware, no rate limiting |

### 1.3 Endpoint Sensitivity Matrix

Reference this matrix when configuring per-endpoint limits:

| Endpoint | Method | Sensitivity | Preset | Limit |
|----------|--------|-------------|--------|-------|
| `/products` | GET | Medium | `publicRead` | 100 req/min |
| `/products/:id` | GET | Medium | `publicRead` | 100 req/min |
| `/categories` | GET | Low | `publicReadRelaxed` | 200 req/min |
| `/hero` | GET | Low | `publicReadRelaxed` | 200 req/min |
| `/external-products/search` | GET | High | `externalApi` | 20 req/min |
| `/external-products/import` | POST | High | `externalApi` | 10 req/min |
| `/upload/*` | POST | Critical | `fileUploads` | 5 req/min |
| `/users/*` (Auth Service) | Various | High | `authenticated` | 30 req/min |
| `/api/categories` (Client) | GET | Medium | `publicRead` | 100 req/min |
| `/api/products` (Client) | GET | Medium | `publicRead` | 100 req/min |
| `/api/hero-products` (Client) | GET | Low | `publicReadRelaxed` | 200 req/min |

### 1.4 Required Environment Variables

Ensure these are set in each service's `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Rate Limiting
DISABLE_RATE_LIMIT=false
INTERNAL_SERVICE_TOKEN=your-internal-service-token
SKIP_RATE_LIMIT_FOR_ADMINS=false

# Proxy Configuration (for accurate IP detection)
TRUST_PROXY=true
```

---

## 2. Step 1: Integrate Rate Limiter into Product Service

### 2.1 Add Workspace Dependency

From the workspace root:

```bash
# Add @repo/rate-limiter to product-service
pnpm add @repo/rate-limiter --filter product-service
```

Verify the dependency was added to [`apps/product-service/package.json`](apps/product-service/package.json):

```json
{
  "dependencies": {
    "@repo/rate-limiter": "workspace:*"
  }
}
```

### 2.2 Update Product Service Entry Point

Modify [`apps/product-service/src/index.ts`](apps/product-service/src/index.ts:1) to integrate rate limiting middleware. The key principle is: **apply rate limiting BEFORE routes, with a global catch-all and specific per-route-group limiters**.

Apply the following changes:

```typescript
// apps/product-service/src/index.ts

// Load environment variables FIRST before any imports that use them
import dotenv from "dotenv";
dotenv.config();

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { rateLimiters, createRateLimiter } from "@repo/rate-limiter";
import { shouldBeUser } from "./middleware/authMiddleware.js";
import productRouter from "./routes/product.route";
import categoryRouter from "./routes/category.route";
import heroRouter from "./routes/hero.route";
import uploadRouter from "./routes/upload.route";
import externalProductRouter from "./routes/externalProduct.route";

const app = express();

const allowedOrigins = [
  "http://localhost:3002",
  "http://localhost:3003",
  "http://localhost:3004",
  "https://neuraltale-client.onrender.com",
  "https://neuraltale-admin.onrender.com",
  "https://backoffice.neuraltale.com",
  "https://neuraltale.com",
  "https://neuraltale.com",
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
].filter((origin): origin is string => Boolean(origin));

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(clerkMiddleware());

// ============================================================
// Trust Proxy - Essential for accurate IP detection behind CDNs
// ============================================================
app.set("trust proxy", true);

// ============================================================
// Rate Limiting - Apply BEFORE routes
// ============================================================

// Global rate limiter (catch-all, most permissive)
app.use(rateLimiters.publicReadRelaxed);

// Health endpoint - no rate limiting (handled by skip function)
app.get("/health", (req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Test endpoint with user auth
app.get("/test", shouldBeUser, (req, res) => {
  res.json({ message: "Product service authenticated", userId: req.userId });
});

// Apply specific rate limiters to route groups
app.use("/products", rateLimiters.publicRead, productRouter);
app.use("/categories", rateLimiters.publicReadRelaxed, categoryRouter);
app.use("/hero", rateLimiters.publicReadRelaxed, heroRouter);
app.use("/upload", rateLimiters.fileUploads, uploadRouter);
app.use("/external-products", rateLimiters.externalApi, externalProductRouter);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.log(err);
  return res
    .status(err.status || 500)
    .json({ message: err.message || "Internal Server Error!" });
});

const PORT = Number(process.env.PORT) || 8000;

const start = async () => {
  try {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Product service is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start product service:", error);
    process.exit(1);
  }
};

start();
```

### 2.3 Key Integration Points

| Line | Purpose |
|------|---------|
| `import { rateLimiters, createRateLimiter }` | Import pre-configured limiters and factory function |
| `app.set("trust proxy", true)` | Enable accurate IP detection behind Cloudflare/CDN |
| `app.use(rateLimiters.publicReadRelaxed)` | Global catch-all limiter (200 req/min) |
| `app.use("/products", rateLimiters.publicRead, ...)` | Products endpoint: 100 req/min |
| `app.use("/categories", rateLimiters.publicReadRelaxed, ...)` | Categories endpoint: 200 req/min |
| `app.use("/upload", rateLimiters.fileUploads, ...)` | Upload endpoint: 5 req/min |
| `app.use("/external-products", rateLimiters.externalApi, ...)` | External API: 20 req/min |

### 2.4 Middleware Order Matters

The order of middleware registration is critical:

```
1. CORS
2. express.json()
3. clerkMiddleware()
4. trust proxy
5. Global rate limiter (catch-all)
6. Health endpoint (exempt via skip function)
7. Route-specific rate limiters + routers
8. Error handler
```

**Warning**: If the global rate limiter is placed AFTER routes, it will not apply. If route-specific limiters are placed BEFORE the global limiter, they will be overridden.

---

## 3. Step 2: Integrate Rate Limiter into Auth Service

### 3.1 Add Workspace Dependency

```bash
pnpm add @repo/rate-limiter --filter auth-service
```

### 3.2 Update Auth Service Entry Point

Modify [`apps/auth-service/src/index.ts`](apps/auth-service/src/index.ts:1):

```typescript
// apps/auth-service/src/index.ts

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";
import { rateLimiters, createRateLimiter } from "@repo/rate-limiter";
import { shouldBeAdmin } from "./middleware/authMiddleware.js";
import userRoute from "./routes/user.route";

dotenv.config();

const app = express();

const allowedOrigins = [
  "http://localhost:3003",
  "https://neuraltale-admin.onrender.com",
  "https://backoffice.neuraltale.com",
  process.env.ADMIN_URL,
].filter((origin): origin is string => Boolean(origin));

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(clerkMiddleware());

// ============================================================
// Trust Proxy
// ============================================================
app.set("trust proxy", true);
 
// ============================================================
// Rate Limiting - Auth endpoints require strict limits
// ============================================================

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

// General user endpoints - moderate limits
app.use("/users", rateLimiters.authenticated, shouldBeAdmin, userRoute);

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health endpoint
app.get("/health", (req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.log(err);
  return res
    .status(err.status || 500)
    .json({ message: err.message || "Internal Server Error!" });
});

const PORT = Number(process.env.PORT) || 8003;

const start = async () => {
  try {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Auth service is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start auth service:", error);
    process.exit(1);
  }
};

start();
```

### 3.3 Auth-Specific Configuration Notes

| Configuration | Value | Rationale |
|---------------|-------|-----------|
| Preset | `authEndpoints` | 15-minute window, 10 max attempts |
| Key Generator | `ip:${req.ip}` | IP-only prevents credential stuffing |
| Custom Message | Specific to auth | Clear user feedback on lockout |
| Window | 900,000ms (15 min) | Deters brute force attacks |

### 3.4 Middleware Order for Auth Service

```
1. CORS
2. express.json()
3. clerkMiddleware()
4. trust proxy
5. Auth endpoint rate limiter (strict, IP-based)
6. General user routes rate limiter + admin middleware
7. Request logging
8. Health endpoint
9. Error handler
```

---

## 4. Step 3: Configure Per-Route Rate Limiting

### 4.1 Product Route Configuration

Update [`apps/product-service/src/routes/product.route.ts`](apps/product-service/src/routes/product.route.ts) to apply different limits per HTTP method:

```typescript
// apps/product-service/src/routes/product.route.ts

import { Router } from "express";
import { rateLimiters, createRateLimiter } from "@repo/rate-limiter";
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  updateProduct,
  getHeroProducts,
} from "../controllers/product.controller.js";
import { shouldBeAdmin } from "../middleware/authMiddleware.js";

const router: Router = Router();

// ============================================================
// Write Operations - Stricter limits (POST/PUT/DELETE)
// ============================================================
router.post("/", rateLimiters.writeOperations, shouldBeAdmin, createProduct);
router.put("/:id", rateLimiters.writeOperations, shouldBeAdmin, updateProduct);
router.delete("/:id", rateLimiters.writeOperations, shouldBeAdmin, deleteProduct);

// ============================================================
// Read Operations - More permissive limits (GET)
// ============================================================
router.get("/hero", rateLimiters.publicReadRelaxed, getHeroProducts);
router.get("/", rateLimiters.publicRead, getProducts);

// Individual product lookup - moderate limits with per-product key
router.get(
  "/:id",
  createRateLimiter({
    preset: "publicRead",
    customOptions: {
      keyGenerator: (req) => {
        const userId = (req as any).userId;
        const productId = req.params.id;
        return userId
          ? `user:${userId}:product:${productId}`
          : `ip:${req.ip}:product:${productId}`;
      },
      max: 50, // Lower limit for individual product access to prevent scraping
    },
  }),
  getProduct
);

export default router;
```

### 4.2 Per-Route Limit Strategy

| Route | Preset | Max | Window | Rationale |
|-------|--------|-----|--------|-----------|
| `POST /products` | `writeOperations` | 30 | 1 min | Admin-only, prevents mass creation |
| `PUT /products/:id` | `writeOperations` | 30 | 1 min | Admin-only, prevents mass updates |
| `DELETE /products/:id` | `writeOperations` | 30 | 1 min | Admin-only, prevents mass deletion |
| `GET /hero` | `publicReadRelaxed` | 200 | 1 min | Low-cost cached endpoint |
| `GET /` (list) | `publicRead` | 100 | 1 min | Database query, moderate cost |
| `GET /:id` (single) | Custom | 50 | 1 min | Per-product key prevents scraping |

### 4.3 Category Route Configuration

Update [`apps/product-service/src/routes/category.route.ts`](apps/product-service/src/routes/category.route.ts):

```typescript
// apps/product-service/src/routes/category.route.ts

import { Router } from "express";
import { rateLimiters } from "@repo/rate-limiter";
import {
  createCategory,
  deleteCategory,
  getCategories,
  getCategory,
  updateCategory,
} from "../controllers/category.controller.js";
import { shouldBeAdmin } from "../middleware/authMiddleware.js";

const router: Router = Router();

// Write operations - admin only, stricter limits
router.post("/", rateLimiters.writeOperations, shouldBeAdmin, createCategory);
router.put("/:id", rateLimiters.writeOperations, shouldBeAdmin, updateCategory);
router.delete("/:id", rateLimiters.writeOperations, shouldBeAdmin, deleteCategory);

// Read operations - public, relaxed limits
router.get("/", rateLimiters.publicReadRelaxed, getCategories);
router.get("/:id", rateLimiters.publicReadRelaxed, getCategory);

export default router;
```

### 4.4 Upload Route Configuration

Update [`apps/product-service/src/routes/upload.route.ts`](apps/product-service/src/routes/upload.route.ts):

```typescript
// apps/product-service/src/routes/upload.route.ts

import { Router } from "express";
import { rateLimiters } from "@repo/rate-limiter";
import { uploadSingle, uploadMultiple } from "../controllers/upload.controller.js";
import { shouldBeAdmin } from "../middleware/authMiddleware.js";

const router: Router = Router();

// All upload routes use the strictest fileUploads preset (5 req/min)
router.post("/single", rateLimiters.fileUploads, shouldBeAdmin, uploadSingle);
router.post("/multiple", rateLimiters.fileUploads, shouldBeAdmin, uploadMultiple);

export default router;
```

### 4.5 External Product Route Configuration

Update [`apps/product-service/src/routes/externalProduct.route.ts`](apps/product-service/src/routes/externalProduct.route.ts):

```typescript
// apps/product-service/src/routes/externalProduct.route.ts

import { Router } from "express";
import { rateLimiters } from "@repo/rate-limiter";
import {
  searchExternalProduct,
  importExternalProduct,
  getExternalProductDetails,
} from "../controllers/externalProduct.controller.js";
import { shouldBeAdmin } from "../middleware/authMiddleware.js";

const router: Router = Router();

// External API proxy - protects third-party quotas
router.get("/search", rateLimiters.externalApi, shouldBeAdmin, searchExternalProduct);
router.post("/import", rateLimiters.externalApi, shouldBeAdmin, importExternalProduct);
router.get("/details/:source/:id", rateLimiters.externalApi, shouldBeAdmin, getExternalProductDetails);

export default router;
```

---

## 5. Step 4: Implement Next.js Client Middleware Rate Limiting

### 5.1 Add Dependencies

```bash
pnpm add @upstash/redis --filter client
```

### 5.2 Create Rate Limiter Library

Create [`apps/client/src/lib/rate-limiter.ts`](apps/client/src/lib/rate-limiter.ts):

```typescript
// apps/client/src/lib/rate-limiter.ts

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
```

### 5.3 Update Client Middleware

Modify [`apps/client/src/middleware.ts`](apps/client/src/middleware.ts:1) to include rate limiting:

```typescript
// apps/client/src/middleware.ts

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";

// ============================================================
// Rate Limit Configuration
// ============================================================

const rateLimitConfig: Record<string, { max: number; windowMs: number }> = {
  "/api/categories": { max: 100, windowMs: 60 * 1000 },
  "/api/products": { max: 100, windowMs: 60 * 1000 },
  "/api/hero-products": { max: 200, windowMs: 60 * 1000 },
};

export default clerkMiddleware(
  async (auth, request: NextRequest) => {
    const { pathname } = request.nextUrl;

    // ============================================================
    // Rate Limiting for API Routes
    // ============================================================
    for (const [prefix, config] of Object.entries(rateLimitConfig)) {
      if (pathname.startsWith(prefix)) {
        // Generate rate limit key
        const { userId } = await auth();
        const ip =
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const rateLimitKey = userId
          ? `user:${userId}:${prefix}`
          : `ip:${ip}:${prefix}`;

        const result = await checkRateLimit(
          rateLimitKey,
          config.max,
          config.windowMs
        );

        if (!result.allowed) {
          const retryAfter = Math.ceil(
            (result.resetTime - Date.now()) / 1000
          );

          return new NextResponse(
            JSON.stringify({
              error: "Too Many Requests",
              message: "Rate limit exceeded. Please try again later.",
              retryAfter,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": retryAfter.toString(),
                "RateLimit-Limit": config.max.toString(),
                "RateLimit-Remaining": "0",
                "RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
                "X-RateLimit-Limit": config.max.toString(),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
              },
            }
          );
        }

        // Continue with rate limit headers on successful responses
        const response = NextResponse.next();
        response.headers.set("RateLimit-Limit", config.max.toString());
        response.headers.set("RateLimit-Remaining", result.remaining.toString());
        response.headers.set(
          "RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString()
        );
        response.headers.set("X-RateLimit-Limit", config.max.toString());
        response.headers.set("X-RateLimit-Remaining", result.remaining.toString());
        response.headers.set(
          "X-RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString()
        );

        // Add security headers
        response.headers.set("X-Content-Type-Options", "nosniff");
        response.headers.set("X-Frame-Options", "DENY");
        response.headers.set("X-XSS-Protection", "1; mode=block");
        response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        response.headers.set("X-DNS-Prefetch-Control", "on");

        // Cache static assets
        if (
          pathname.startsWith("/_next/static/") ||
          pathname.match(
            /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|woff|woff2|ttf|eot)$/i
          )
        ) {
          response.headers.set(
            "Cache-Control",
            "public, max-age=31536000, immutable"
          );
        }

        return response;
      }
    }

    // ============================================================
    // Non-API routes - security headers only
    // ============================================================
    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-DNS-Prefetch-Control", "on");

    // Cache static assets
    if (
      pathname.startsWith("/_next/static/") ||
      pathname.match(
        /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|woff|woff2|ttf|eot)$/i
      )
    ) {
      response.headers.set(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );
    }

    return response;
  },
  {
    debug: process.env.NODE_ENV === "development",
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  }
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

### 5.4 Client API Route Updates

Update each client API route to include rate limiting headers. Example for [`apps/client/src/app/api/products/route.ts`](apps/client/src/app/api/products/route.ts):

```typescript
// apps/client/src/app/api/products/route.ts

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/rate-limiter";

export async function GET(request: Request) {
  const { userId } = await auth();
  const ip =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const key = userId
    ? `user:${userId}:products`
    : `ip:${ip}:products`;

  const result = await checkRateLimit(key, 100, 60);

  const headers = new Headers();
  headers.set("RateLimit-Limit", result.limit.toString());
  headers.set("RateLimit-Remaining", result.remaining.toString());
  headers.set("RateLimit-Reset", result.reset.toString());

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

## 6. Step 5: Implement Next.js Admin Middleware Rate Limiting

### 6.1 Add Dependencies

```bash
pnpm add @upstash/redis --filter admin
```

### 6.2 Create Rate Limiter Library

Create [`apps/admin/src/lib/rate-limiter.ts`](apps/admin/src/lib/rate-limiter.ts) — same structure as the client version but with admin-specific configuration:

```typescript
// apps/admin/src/lib/rate-limiter.ts

import { Redis } from "@upstash/redis";

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

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetTime < now) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

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
    const windowKey = `ratelimit:admin:${key}:${Math.floor(now / windowMs)}`;

    const pipeline = client.pipeline();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, Math.ceil(windowMs / 1000) * 2);

    const results = await pipeline.exec<[number, number]>();
    const count = results?.[0]?.[1] as number;

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetTime: now + windowMs,
    };
  } catch (error) {
    console.error("[Admin RateLimiter] Redis error:", error);
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
    const newEntry = { count: 1, resetTime: now + windowMs };
    memoryStore.set(key, newEntry);
    return { allowed: true, remaining: max - 1, resetTime: newEntry.resetTime };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }

  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetTime: entry.resetTime };
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redisResult = await checkRateLimitRedis(key, max, windowMs);
  if (redisResult) return redisResult;
  return checkRateLimitMemory(key, max, windowMs);
}
```

### 6.3 Update Admin Middleware

Modify [`apps/admin/src/middleware.ts`](apps/admin/src/middleware.ts:1):

```typescript
// apps/admin/src/middleware.ts

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";

// Admin-specific rate limit configuration (more permissive for authenticated admins)
const rateLimitConfig: Record<string, { max: number; windowMs: number }> = {
  "/api/categories": { max: 150, windowMs: 60 * 1000 },
  "/api/products": { max: 150, windowMs: 60 * 1000 },
  "/api/users": { max: 100, windowMs: 60 * 1000 },
  "/api/orders": { max: 100, windowMs: 60 * 1000 },
};

export default clerkMiddleware(
  async (auth, request: NextRequest) => {
    const { pathname } = request.nextUrl;

    // Rate limiting for API routes
    for (const [prefix, config] of Object.entries(rateLimitConfig)) {
      if (pathname.startsWith(prefix)) {
        const { userId } = await auth();
        const ip =
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const rateLimitKey = userId
          ? `admin-user:${userId}:${prefix}`
          : `admin-ip:${ip}:${prefix}`;

        const result = await checkRateLimit(
          rateLimitKey,
          config.max,
          config.windowMs
        );

        if (!result.allowed) {
          const retryAfter = Math.ceil(
            (result.resetTime - Date.now()) / 1000
          );

          return new NextResponse(
            JSON.stringify({
              error: "Too Many Requests",
              message: "Rate limit exceeded. Please try again later.",
              retryAfter,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": retryAfter.toString(),
                "RateLimit-Limit": config.max.toString(),
                "RateLimit-Remaining": "0",
                "RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
              },
            }
          );
        }

        const response = NextResponse.next();
        response.headers.set("RateLimit-Limit", config.max.toString());
        response.headers.set("RateLimit-Remaining", result.remaining.toString());
        response.headers.set(
          "RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString()
        );

        return response;
      }
    }

    return NextResponse.next();
  },
  {
    debug: process.env.NODE_ENV === "development",
    signInUrl: "/sign-in",
  }
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

---

## 7. Step 6: Implement Graceful Degradation

### 7.1 Create Fallback Store Module

Create [`packages/rate-limiter/src/fallback.ts`](packages/rate-limiter/src/fallback.ts):

```typescript
// packages/rate-limiter/src/fallback.ts

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
        retryAfter: req.rateLimit?.resetTime
          ? Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
          : 60,
        fallback: useFallback,
      });
    },
  });
};
```

### 7.2 Export Fallback from Main Module

Add to [`packages/rate-limiter/src/index.ts`](packages/rate-limiter/src/index.ts):

```typescript
// Add these exports at the bottom of the file
export { createFallbackStore, createResilientRateLimiter } from "./fallback";
```

### 7.3 Graceful Degradation Behavior

| Scenario | Behavior | Impact |
|----------|----------|--------|
| Redis unavailable | Falls back to in-memory Map | Rate limits are per-instance, not distributed |
| Redis reconnects | Automatically switches back to Redis | Distributed rate limiting restored |
| High memory pressure | LRU eviction in fallback store | Oldest entries removed first |
| All instances down | Each instance enforces its own limits | More permissive overall (N × limit) |

### 7.4 Health Check Integration

The `skipRateLimit` function already handles health checks:

```typescript
export const skipRateLimit = (req: Request): boolean => {
  // Skip health checks
  if (req.path === "/health" || req.path === "/ready") {
    return true;
  }
  // ... other skip conditions
};
```

Ensure all services expose `/health` and `/ready` endpoints that are excluded from rate limiting.

---

## 8. Verification Procedures

### 8.1 Unit Test Each Service

Create test files for each service. Example for Product Service:

```typescript
// apps/product-service/src/__tests__/rate-limit.integration.ts

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { rateLimiters } from "@repo/rate-limiter";

describe("Product Service Rate Limiting", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.set("trust proxy", true);
    app.use(express.json());

    // Apply rate limiters
    app.use(rateLimiters.publicReadRelaxed);
    app.use("/products", rateLimiters.publicRead);
    app.use("/categories", rateLimiters.publicReadRelaxed);
    app.use("/upload", rateLimiters.fileUploads);
    app.use("/external-products", rateLimiters.externalApi);

    // Mock routes
    app.get("/health", (req, res) => res.json({ status: "ok" }));
    app.get("/products", (req, res) => res.json([]));
    app.get("/categories", (req, res) => res.json([]));
    app.post("/upload", (req, res) => res.json({ uploaded: true }));
    app.get("/external-products/search", (req, res) => res.json({ results: [] }));
  });

  it("should allow requests within limit on /products", async () => {
    for (let i = 0; i < 100; i++) {
      const res = await request(app).get("/products");
      expect(res.status).toBe(200);
    }
  });

  it("should reject requests exceeding limit on /products", async () => {
    const res = await request(app).get("/products");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too Many Requests");
  });

  it("should include rate limit headers", async () => {
    // Reset by waiting for window expiry or using fresh key
    const res = await request(app).get("/categories");
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
    expect(res.headers["ratelimit-reset"]).toBeDefined();
  });

  it("should apply stricter limits to /upload", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/upload");
      expect(res.status).toBe(200);
    }
    const res = await request(app).post("/upload");
    expect(res.status).toBe(429);
  });

  it("should apply external API limits to /external-products/search", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get("/external-products/search");
      expect(res.status).toBe(200);
    }
    const res = await request(app).get("/external-products/search");
    expect(res.status).toBe(429);
  });

  it("should NOT rate limit /health endpoint", async () => {
    for (let i = 0; i < 500; i++) {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    }
  });
});
```

### 8.2 Integration Test Script

Create [`scripts/test-phase2-rate-limit.sh`](scripts/test-phase2-rate-limit.sh):

```bash
#!/bin/bash

echo "========================================="
echo "Phase 2 Rate Limiting Integration Tests"
echo "========================================="

PRODUCT_SERVICE="http://localhost:8000"
AUTH_SERVICE="http://localhost:8003"
CLIENT_APP="http://localhost:3002"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass_count=0
fail_count=0

test_endpoint() {
  local url=$1
  local expected=$2
  local description=$3
  local method=${4:-GET}

  status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url")

  if [ "$status" = "$expected" ]; then
    echo -e "${GREEN}PASS${NC}: $description (HTTP $status)"
    pass_count=$((pass_count + 1))
  else
    echo -e "${RED}FAIL${NC}: $description (Expected $expected, got $status)"
    fail_count=$((fail_count + 1))
  fi
}

echo ""
echo "--- Product Service Tests ---"

# Test products endpoint (100 req/min limit)
echo "Sending 101 requests to /products..."
for i in $(seq 1 101); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$PRODUCT_SERVICE/products")
done
if [ "$status" = "429" ]; then
  echo -e "${GREEN}PASS${NC}: Products rate limited after 100 requests"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: Products not rate limited (HTTP $status)"
  fail_count=$((fail_count + 1))
fi

# Test categories endpoint (200 req/min limit)
echo "Sending 101 requests to /categories (should still pass)..."
for i in $(seq 1 101); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$PRODUCT_SERVICE/categories")
done
if [ "$status" = "200" ]; then
  echo -e "${GREEN}PASS${NC}: Categories allows 100+ requests (200/min limit)"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: Categories unexpectedly rate limited (HTTP $status)"
  fail_count=$((fail_count + 1))
fi

# Test health endpoint (no rate limit)
echo "Sending 300 requests to /health..."
for i in $(seq 1 300); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$PRODUCT_SERVICE/health")
done
if [ "$status" = "200" ]; then
  echo -e "${GREEN}PASS${NC}: Health endpoint not rate limited"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: Health endpoint unexpectedly rate limited (HTTP $status)"
  fail_count=$((fail_count + 1))
fi

# Test upload endpoint (5 req/min limit)
echo "Sending 6 requests to /upload..."
for i in $(seq 1 6); do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PRODUCT_SERVICE/upload")
done
if [ "$status" = "429" ]; then
  echo -e "${GREEN}PASS${NC}: Upload rate limited after 5 requests"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: Upload not rate limited (HTTP $status)"
  fail_count=$((fail_count + 1))
fi

echo ""
echo "--- Response Header Tests ---"

# Check rate limit headers
headers=$(curl -s -I "$PRODUCT_SERVICE/categories" 2>/dev/null)
if echo "$headers" | grep -qi "ratelimit-limit"; then
  echo -e "${GREEN}PASS${NC}: RateLimit-Limit header present"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: RateLimit-Limit header missing"
  fail_count=$((fail_count + 1))
fi

if echo "$headers" | grep -qi "ratelimit-remaining"; then
  echo -e "${GREEN}PASS${NC}: RateLimit-Remaining header present"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: RateLimit-Remaining header missing"
  fail_count=$((fail_count + 1))
fi

if echo "$headers" | grep -qi "ratelimit-reset"; then
  echo -e "${GREEN}PASS${NC}: RateLimit-Reset header present"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}FAIL${NC}: RateLimit-Reset header missing"
  fail_count=$((fail_count + 1))
fi

echo ""
echo "========================================="
echo "Results: ${pass_count} passed, ${fail_count} failed"
echo "========================================="

if [ $fail_count -gt 0 ]; then
  exit 1
fi
```

Make executable and run:
```bash
chmod +x scripts/test-phase2-rate-limit.sh
./scripts/test-phase2-rate-limit.sh
```

### 8.3 Verify Redis Storage

```bash
# Check rate limit keys in Redis
redis-cli keys "ratelimit:*"

# Expected output:
# "ratelimit:ip:127.0.0.1"
# "ratelimit:user:usr_abc123:product:456"
# "ratelimit:ip:192.168.1.1:product:789"

# Check TTL of a key
redis-cli ttl "ratelimit:ip:127.0.0.1"
# Expected: positive integer (seconds until expiry)

# Monitor Redis in real-time during testing
redis-cli monitor | grep ratelimit
```

### 8.4 Verify Next.js Middleware Rate Limiting

```bash
# Test client API rate limiting
for i in $(seq 1 105); do
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:3002/api/products"
  echo ""
done
# Expected: First 100 return 200, remaining return 429

# Test admin API rate limiting
for i in $(seq 1 155); do
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/api/products"
  echo ""
done
# Expected: First 150 return 200, remaining return 429
```

### 8.5 Verify Graceful Degradation

```bash
# Stop Redis
docker stop rate-limit-redis

# Send requests - should still work with in-memory fallback
curl http://localhost:8000/products
# Expected: 200 response

# Check service logs for fallback message
docker logs product-service | grep "in-memory"
# Expected: "[RateLimiter] Redis unavailable, using in-memory store"

# Restart Redis
docker start rate-limit-redis

# Verify Redis reconnection
docker logs product-service | grep "Connected to Redis"
# Expected: "[RateLimiter] Connected to Redis"
```

---

## 9. Troubleshooting

### 9.1 Common Issues and Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| Rate limiter not applied | All requests pass, no 429 responses | Check middleware order — rate limiter must be BEFORE routes |
| All requests blocked | Every request returns 429 | Verify `trust proxy` is set correctly; check IP extraction |
| Inconsistent limits across instances | Different instances allow different request counts | Ensure Redis is being used, not in-memory store |
| Headers missing | No `RateLimit-*` headers in response | Verify `standardHeaders: true` in rate limiter config |
| Auth service not rate limited | Auth endpoints allow unlimited requests | Check that `/users/auth` route matches the rate limiter placement |
| Next.js middleware not rate limiting | Client API routes have no rate limits | Verify `checkRateLimit` is called in middleware loop |
| Redis connection timeout | `[RateLimiter] Redis error: connect ETIMEDOUT` | Check `REDIS_HOST` and network connectivity |
| Workspace reference fails | `@repo/rate-limiter` not found | Run `pnpm install` at workspace root |
| TypeScript errors in routes | Type errors on `req.userId` | Ensure `@clerk/express` types are imported |

### 9.2 Debug Mode

Enable verbose logging during development:

```env
# In .env files
NODE_ENV=development
DISABLE_RATE_LIMIT=true  # Temporarily bypass all rate limiting
```

### 9.3 Redis Debugging Commands

```bash
# Test Redis connectivity
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

# View all rate limit keys
redis-cli keys "ratelimit:*"

# Get value of specific key
redis-cli get "ratelimit:ip:127.0.0.1"

# Get TTL
redis-cli ttl "ratelimit:ip:127.0.0.1"

# Delete specific key (reset rate limit for testing)
redis-cli del "ratelimit:ip:127.0.0.1"

# Flush all rate limit keys
redis-cli keys "ratelimit:*" | xargs redis-cli del

# Monitor Redis operations in real-time
redis-cli monitor | grep ratelimit
```

### 9.4 Service Log Analysis

```bash
# Check for rate limit violations in logs
docker logs product-service 2>&1 | grep "Rate limit exceeded"

# Check for Redis connection issues
docker logs product-service 2>&1 | grep -i "redis"

# Check for fallback activation
docker logs product-service 2>&1 | grep "fallback"

# Kubernetes equivalent
kubectl logs deployment/product-service --tail=100 | grep -i "ratelimit"
```

### 9.5 Emergency Procedures

```bash
# Emergency: Disable rate limiting on Product Service
kubectl set env deployment/product-service DISABLE_RATE_LIMIT=true
kubectl rollout restart deployment/product-service

# Emergency: Increase rate limits
kubectl set env deployment/product-service RATE_LIMIT_MAX_REQUESTS=500
kubectl rollout restart deployment/product-service

# Emergency: Clear all rate limits
redis-cli keys "ratelimit:*" | xargs redis-cli del

# Emergency: Block abusive IP
redis-cli SET "block:ip:1.2.3.4" "1" EX 3600
```

### 9.6 Performance Issues

If rate limiting adds noticeable latency:

1. **Check Redis latency**:
   ```bash
   redis-cli --latency
   # Expected: < 1ms for local Redis
   ```

2. **Verify connection pooling** — ioredis handles this automatically

3. **Check for key explosion** — too many unique keys can increase memory:
   ```bash
   redis-cli dbsize
   redis-cli info memory
   ```

4. **Monitor rate limiter overhead**:
   ```typescript
   // Add timing middleware before rate limiter
   app.use((req, res, next) => {
     const start = process.hrtime.bigint();
     res.on("finish", () => {
       const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
       if (duration > 50) {
         console.warn(`[Performance] Slow request: ${duration.toFixed(2)}ms - ${req.path}`);
       }
     });
     next();
   });
   ```

### 9.7 Phase 2 Completion Checklist

Before marking Phase 2 as complete, verify:

- [ ] Product Service has global and per-route rate limiters applied
- [ ] Auth Service has strict auth endpoint rate limiting (IP-based, 15-min window)
- [ ] Per-route rate limiting configured for products, categories, uploads, external products
- [ ] Client Next.js middleware has rate limiting with Redis + in-memory fallback
- [ ] Admin Next.js middleware has rate limiting with admin-specific limits
- [ ] Graceful degradation implemented — services fall back to in-memory on Redis failure
- [ ] Rate limit headers present on all rate-limited responses
- [ ] Health check endpoints bypass rate limiting in all services
- [ ] Integration tests pass for all services
- [ ] Load test script executes successfully

---

## Next Steps: Phase 3 Preview

Once Phase 2 is complete, proceed to Phase 3: Monitoring & Testing

- Set up Prometheus metrics collection for rate limit events
- Configure Grafana dashboards for rate limit visualization
- Write k6 load tests to validate rate limits under stress
- Create alerting rules for high rejection rates
- Document runbooks for rate limit incidents

Refer to [`RATE_LIMITING_GUIDE.md`](docs/RATE_LIMITING_GUIDE.md:1434) for Phase 3 specifications.
