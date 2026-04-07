# Phase 1: Rate Limiting Foundation - Step-by-Step Implementation Guide

> **Purpose**: This guide provides a detailed, executable implementation plan for Phase 1 of the rate limiting system as specified in [`RATE_LIMITING_GUIDE.md`](docs/RATE_LIMITING_GUIDE.md:1).
>
> **Scope**: Foundation setup including dependency installation, shared middleware creation, Redis-based storage implementation, and standard response headers.
>
> **Estimated Duration**: 1 week
>
> **Target Environment**: Production-ready microservices with pnpm workspaces, Express.js services, and Next.js applications.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1: Install Rate Limiting Dependencies](#2-step-1-install-rate-limiting-dependencies)
3. [Step 2: Create Shared Rate Limiter Package](#3-step-2-create-shared-rate-limiter-package)
4. [Step 3: Implement Redis-Based Storage](#4-step-3-implement-redis-based-storage)
5. [Step 4: Add Standard Response Headers](#5-step-4-add-standard-response-headers)
6. [Step 5: Configure Environment Variables](#6-step-5-configure-environment-variables)
7. [Verification Procedures](#7-verification-procedures)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

Before beginning Phase 1 implementation, ensure the following are in place:

### 1.1 Infrastructure Requirements

| Component | Minimum Version | Purpose |
|-----------|-----------------|---------|
| Node.js | 20.x LTS | Runtime environment |
| pnpm | 9.x+ | Package manager (workspace support) |
| Redis | 6.2+ | Distributed rate limit storage |
| Docker (optional) | 24.x+ | Containerized Redis for development |

### 1.2 Existing Service Knowledge

Familiarize yourself with the current service topology:

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
```

### 1.3 Workspace Structure Verification

Confirm the pnpm workspace is properly configured:

```bash
# Verify workspace root
cat pnpm-workspace.yaml
```

Expected output should include:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 1.4 Redis Availability

```bash
# Test Redis connectivity
redis-cli ping
# Expected response: PONG

# If Redis is not installed, start via Docker:
docker run -d --name rate-limit-redis -p 6379:6379 redis:7-alpine
```

---

## 2. Step 1: Install Rate Limiting Dependencies

### 2.1 Create the Shared Package Directory

```bash
# Create the packages directory if it doesn't exist
mkdir -p packages/rate-limiter/src

# Initialize the package
cd packages/rate-limiter
pnpm init
```

### 2.2 Install Core Dependencies

Run these commands from the **workspace root**:

```bash
# Install rate limiting libraries in the shared package
pnpm add express-rate-limit rate-limit-redis ioredis --filter @repo/rate-limiter

# Install TypeScript and type definitions as dev dependencies
pnpm add -D typescript @types/express @types/node --filter @repo/rate-limiter
```

### 2.3 Install Dependencies in Each Express Service

```bash
# Product Service
pnpm add express-rate-limit rate-limit-redis ioredis --filter product-service

# Auth Service
pnpm add express-rate-limit rate-limit-redis ioredis --filter auth-service

# Order Service (if exists)
pnpm add express-rate-limit rate-limit-redis ioredis --filter order-service

# Payment Service (if exists)
pnpm add express-rate-limit rate-limit-redis ioredis --filter payment-service
```

### 2.4 Install Next.js Client Dependencies

```bash
# For in-memory rate limiting (development/edge)
pnpm add @upstash/redis --filter client

# For admin app rate limiting
pnpm add @upstash/redis --filter admin
```

### 2.5 Verify Installation

```bash
# Check installed packages in rate-limiter
pnpm list --filter @repo/rate-limiter

# Expected output should include:
# express-rate-limit@^7.x.x
# rate-limit-redis@^4.x.x
# ioredis@^5.x.x
```

---

## 3. Step 2: Create Shared Rate Limiter Package

### 3.1 Configure Package Metadata

Create or update [`packages/rate-limiter/package.json`](packages/rate-limiter/package.json):

```json
{
  "name": "@repo/rate-limiter",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "express-rate-limit": "^7.1.5",
    "rate-limit-redis": "^4.2.0",
    "ioredis": "^5.3.2"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^20.0.0",
    "express": "^5.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 3.2 Configure TypeScript

Create [`packages/rate-limiter/tsconfig.json`](packages/rate-limiter/tsconfig.json):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 3.3 Create the Main Rate Limiter Module

Create [`packages/rate-limiter/src/index.ts`](packages/rate-limiter/src/index.ts) with the following complete implementation:

```typescript
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
          return null;
        }
        return Math.min(times * 100, 3000);
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
  publicRead: {
    windowMs: 60 * 1000,
    max: 100,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },
  publicReadRelaxed: {
    windowMs: 60 * 1000,
    max: 200,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },
  authenticated: {
    windowMs: 60 * 1000,
    max: 150,
    message: "Too many requests, please try again later.",
    statusCode: 429,
  },
  writeOperations: {
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many write requests, please try again later.",
    statusCode: 429,
  },
  externalApi: {
    windowMs: 60 * 1000,
    max: 20,
    message: "Rate limit exceeded for external API. Please wait before trying again.",
    statusCode: 429,
  },
  fileUploads: {
    windowMs: 60 * 1000,
    max: 5,
    message: "Too many upload requests, please try again later.",
    statusCode: 429,
  },
  authEndpoints: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many authentication attempts, please try again later.",
    statusCode: 429,
  },
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
  const userId = (req as any).userId;
  const apiKey = req.headers["x-api-key"] as string;
  const ip = req.ip || req.socket.remoteAddress;

  if (userId) return `user:${userId}`;
  if (apiKey) return `apikey:${apiKey}`;
  return `ip:${ip}`;
};

export const generateStrictIPKey = (req: Request): string => {
  return `ip:${req.ip || req.socket.remoteAddress}`;
};

// ============================================================
// Handler Functions
// ============================================================

export const rateLimitHandler = (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const key = generateKey(req);

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
  if (process.env.NODE_ENV === "development" && process.env.DISABLE_RATE_LIMIT === "true") {
    return true;
  }

  if (req.path === "/health" || req.path === "/ready") {
    return true;
  }

  const internalToken = req.headers["x-internal-token"];
  if (internalToken === process.env.INTERNAL_SERVICE_TOKEN) {
    return true;
  }

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
    standardHeaders: true,
    legacyHeaders: false,
    requestWasSuccessful: (req, res) => res.statusCode < 400,
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

### 3.4 Build the Package

```bash
cd packages/rate-limiter
pnpm build
```

### 3.5 Add Workspace Reference

Ensure each Express service references the shared package. Update each service's `package.json`:

```json
{
  "dependencies": {
    "@repo/rate-limiter": "workspace:*"
  }
}
```

Then run from workspace root:

```bash
pnpm install
```

---

## 4. Step 3: Implement Redis-Based Storage

### 4.1 Redis Connection Configuration

The Redis connection is already implemented in the [`getRedisClient()`](packages/rate-limiter/src/index.ts:24) function above. Key configuration points:

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | `undefined` | Redis authentication password |

### 4.2 Redis Key Prefix Strategy

All rate limiting keys are prefixed with `ratelimit:` to avoid collisions with other Redis data:

```
ratelimit:user:123
ratelimit:apikey:abc123
ratelimit:ip:192.168.1.1
ratelimit:ip:192.168.1.1:product:456
```

### 4.3 Redis Connection Resilience

The implementation includes automatic retry with exponential backoff:

- **Initial retry**: 100ms
- **Maximum retry delay**: 3000ms
- **Maximum attempts**: 10
- **Failure behavior**: Returns `null` to stop retries

### 4.4 Local Development Setup

For local development without external Redis:

```bash
# Option 1: Docker
docker run -d --name rate-limit-redis -p 6379:6379 redis:7-alpine

# Option 2: Disable Redis (falls back to in-memory)
export REDIS_HOST=""
export DISABLE_RATE_LIMIT=true  # Development only
```

### 4.5 Production Redis Setup

For production deployments:

```bash
# Redis with persistence
docker run -d \
  --name rate-limit-redis \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine \
  redis-server --appendonly yes --requirepass your-secure-password
```

Set environment variables:
```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-secure-password
```

---

## 5. Step 4: Add Standard Response Headers

### 5.1 Header Configuration

The rate limiter is configured to send standard headers via `standardHeaders: true` in the base configuration. This automatically adds:

```
RateLimit-Limit: 100
RateLimit-Remaining: 42
RateLimit-Reset: 1712246400
```

### 5.2 Legacy Header Support (Optional)

If backward compatibility is needed, modify the base configuration:

```typescript
const baseConfig: RateLimitOptions = {
  // ... existing config
  standardHeaders: true,    // Sends RateLimit-* headers (IETF draft)
  legacyHeaders: true,      // Sends X-RateLimit-* headers
};
```

### 5.3 429 Response Headers

When rate limit is exceeded, the response includes:

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 1712246400
Retry-After: 38
```

Response body:
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 38 seconds.",
  "retryAfter": 38,
  "path": "/api/products"
}
```

### 5.4 Custom Header Implementation

For additional custom headers, create [`packages/rate-limiter/src/headers.ts`](packages/rate-limiter/src/headers.ts):

```typescript
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
```

---

## 6. Step 5: Configure Environment Variables

### 6.1 Create Environment Files

Create or update `.env` files in each service that will use rate limiting:

**Product Service** ([`apps/product-service/.env`](apps/product-service/.env)):
```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Rate Limiting
DISABLE_RATE_LIMIT=false
INTERNAL_SERVICE_TOKEN=your-internal-service-token
SKIP_RATE_LIMIT_FOR_ADMINS=false
```

**Auth Service** ([`apps/auth-service/.env`](apps/auth-service/.env)):
```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Rate Limiting
DISABLE_RATE_LIMIT=false
INTERNAL_SERVICE_TOKEN=your-internal-service-token
SKIP_RATE_LIMIT_FOR_ADMINS=false
```

**Client App** ([`apps/client/.env.local`](apps/client/.env.local)):
```env
# Upstash Redis (for production rate limiting)
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Development: disable rate limiting
DISABLE_RATE_LIMIT=true
```

### 6.2 Generate Internal Service Token

```bash
# Generate a secure random token
openssl rand -hex 32
```

### 6.3 Add to Docker Compose (if applicable)

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  product-service:
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - INTERNAL_SERVICE_TOKEN=${INTERNAL_SERVICE_TOKEN}

volumes:
  redis-data:
```

---

## 7. Verification Procedures

### 7.1 Unit Test the Rate Limiter Package

Create [`packages/rate-limiter/src/index.test.ts`](packages/rate-limiter/src/index.test.ts):

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RATE_LIMIT_PRESETS, generateKey, skipRateLimit } from "./index";

describe("Rate Limiter Configuration", () => {
  it("should have all required presets", () => {
    const requiredPresets = [
      "publicRead",
      "publicReadRelaxed",
      "authenticated",
      "writeOperations",
      "externalApi",
      "fileUploads",
      "authEndpoints",
      "critical",
    ];

    requiredPresets.forEach((preset) => {
      expect(RATE_LIMIT_PRESETS[preset]).toBeDefined();
      expect(RATE_LIMIT_PRESETS[preset].windowMs).toBeGreaterThan(0);
      expect(RATE_LIMIT_PRESETS[preset].max).toBeGreaterThan(0);
      expect(RATE_LIMIT_PRESETS[preset].statusCode).toBe(429);
    });
  });

  it("should generate correct key for user", () => {
    const req = { userId: "user123" } as any;
    expect(generateKey(req)).toBe("user:user123");
  });

  it("should generate correct key for API key", () => {
    const req = { headers: { "x-api-key": "key123" } } as any;
    expect(generateKey(req)).toBe("apikey:key123");
  });

  it("should generate correct key for IP", () => {
    const req = { ip: "192.168.1.1" } as any;
    expect(generateKey(req)).toBe("ip:192.168.1.1");
  });

  it("should skip rate limiting for health endpoints", () => {
    const req = { path: "/health" } as any;
    expect(skipRateLimit(req)).toBe(true);
  });

  it("should skip rate limiting for ready endpoint", () => {
    const req = { path: "/ready" } as any;
    expect(skipRateLimit(req)).toBe(true);
  });
});
```

Run tests:
```bash
cd packages/rate-limiter
pnpm test
```

### 7.2 Integration Test with Express Service

Create a test script [`scripts/test-rate-limit.sh`](scripts/test-rate-limit.sh):

```bash
#!/bin/bash

# Test rate limiting on product service
BASE_URL="http://localhost:8000"
ENDPOINT="/products"
MAX_REQUESTS=105  # Slightly over the 100 req/min limit

echo "Testing rate limiting on ${BASE_URL}${ENDPOINT}"
echo "Sending ${MAX_REQUESTS} requests..."

success_count=0
rejected_count=0

for i in $(seq 1 $MAX_REQUESTS); do
  response=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${ENDPOINT}")
  
  if [ "$response" = "200" ]; then
    success_count=$((success_count + 1))
  elif [ "$response" = "429" ]; then
    rejected_count=$((rejected_count + 1))
  fi
  
  # Print progress every 10 requests
  if [ $((i % 10)) -eq 0 ]; then
    echo "Progress: ${i}/${MAX_REQUESTS} - Success: ${success_count}, Rejected: ${rejected_count}"
  fi
done

echo ""
echo "=== Results ==="
echo "Successful requests: ${success_count}"
echo "Rejected requests: ${rejected_count}"

if [ $rejected_count -gt 0 ]; then
  echo "✅ Rate limiting is working correctly"
else
  echo "❌ Rate limiting may not be configured correctly"
fi
```

Make executable and run:
```bash
chmod +x scripts/test-rate-limit.sh
./scripts/test-rate-limit.sh
```

### 7.3 Verify Response Headers

```bash
# Test headers on a rate-limited endpoint
curl -i http://localhost:8000/products

# Expected headers in response:
# RateLimit-Limit: 100
# RateLimit-Remaining: 99
# RateLimit-Reset: <unix_timestamp>
```

### 7.4 Verify Redis Storage

```bash
# Check Redis keys
redis-cli keys "ratelimit:*"

# Check specific key TTL
redis-cli ttl "ratelimit:ip:127.0.0.1"

# Monitor Redis in real-time
redis-cli monitor | grep ratelimit
```

### 7.5 Verify Graceful Degradation

```bash
# Stop Redis and test fallback
docker stop rate-limit-redis

# Send requests - should still work with in-memory fallback
curl http://localhost:8000/products

# Check logs for fallback message
# Expected: "[RateLimiter] Redis unavailable, using in-memory store"
```

---

## 8. Troubleshooting

### 8.1 Common Issues and Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| Redis Connection Refused | `[RateLimiter] Redis error: connect ECONNREFUSED` | Verify Redis is running: `redis-cli ping` |
| Rate Limit Not Working | No 429 responses after many requests | Check `DISABLE_RATE_LIMIT=true` is not set |
| Wrong IP Address | All requests from same IP | Set `trustProxy: true` and verify proxy config |
| Package Not Found | `@repo/rate-limiter` not resolved | Run `pnpm install` at workspace root |
| TypeScript Errors | Type errors in rate limiter | Ensure `@types/express` is installed |
| Headers Not Showing | No RateLimit-* headers | Verify `standardHeaders: true` in config |

### 8.2 Debug Mode

Enable verbose logging:

```env
# In .env files
NODE_ENV=development
DISABLE_RATE_LIMIT=true  # Temporarily disable for debugging
```

### 8.3 Redis Connection Debugging

```bash
# Test Redis connectivity
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD ping

# Check Redis logs
docker logs rate-limit-redis

# Check Redis memory usage
redis-cli info memory
```

### 8.4 Rate Limit Key Inspection

```bash
# View all rate limit keys
redis-cli keys "ratelimit:*"

# Get value of specific key
redis-cli get "ratelimit:ip:127.0.0.1"

# Get TTL of key
redis-cli ttl "ratelimit:ip:127.0.0.1"

# Delete specific key (to reset rate limit)
redis-cli del "ratelimit:ip:127.0.0.1"

# Flush all rate limit keys
redis-cli keys "ratelimit:*" | xargs redis-cli del
```

### 8.5 Performance Issues

If rate limiting causes latency:

1. **Check Redis latency**:
   ```bash
   redis-cli --latency
   ```

2. **Verify connection pooling** - ioredis handles this automatically

3. **Monitor Redis memory**:
   ```bash
   redis-cli info memory
   ```

4. **Consider key expiration** - keys auto-expire based on `windowMs`

### 8.6 Production Checklist

Before deploying Phase 1 to production:

- [ ] Redis is running with persistence enabled
- [ ] `REDIS_PASSWORD` is set to a secure value
- [ ] `DISABLE_RATE_LIMIT=false` in all services
- [ ] `INTERNAL_SERVICE_TOKEN` is set and unique
- [ ] Rate limit presets match expected traffic patterns
- [ ] Health check endpoints are excluded from rate limiting
- [ ] Response headers are verified on all endpoints
- [ ] Load testing confirms rate limits work under pressure
- [ ] Monitoring is configured for rate limit metrics
- [ ] Runbook is documented for on-call team

---

## Phase 1 Completion Criteria

Phase 1 is complete when:

1. ✅ `@repo/rate-limiter` package is created and builds successfully
2. ✅ Redis-based storage is operational with graceful fallback
3. ✅ All rate limit presets are configured and tested
4. ✅ Standard response headers are present on all rate-limited endpoints
5. ✅ Health check endpoints bypass rate limiting
6. ✅ Internal service-to-service calls bypass rate limiting
7. ✅ Integration tests pass with expected 429 responses
8. ✅ Documentation is updated with this guide

---

## Next Steps: Phase 2 Preview

Once Phase 1 is complete, proceed to Phase 2: Service Integration

- Integrate rate limiter into Express service route handlers
- Add Next.js middleware-based rate limiting
- Configure per-endpoint rate limits based on the [endpoint sensitivity matrix](docs/RATE_LIMITING_GUIDE.md:64)
- Implement graceful degradation for Redis failures

Refer to [`RATE_LIMITING_GUIDE.md`](docs/RATE_LIMITING_GUIDE.md:132) for Phase 2 specifications.
