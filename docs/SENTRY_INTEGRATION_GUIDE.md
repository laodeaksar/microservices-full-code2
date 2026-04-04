# Sentry Integration Guide for Neuraltale Microservices

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Initialization with Environment-Specific DSNs](#initialization-with-environment-specific-dsns)
5. [Source Map Configuration](#source-map-configuration)
6. [Distributed Tracing & Performance Monitoring](#distributed-tracing--performance-monitoring)
7. [Automated Release Tracking](#automated-release-tracking)
8. [Filtering Sensitive Data](#filtering-sensitive-data)
9. [Environment Variable Management](#environment-variable-management)
10. [Custom Error Boundaries & Breadcrumbs](#custom-error-boundaries--breadcrumbs)
11. [Test Error Verification](#test-error-verification)
12. [Troubleshooting Common Issues](#troubleshooting-common-issues)
13. [Environment-Specific Configurations](#environment-specific-configurations)

---

## Overview

This guide provides comprehensive instructions for integrating Sentry error and performance monitoring into the Neuraltale microservices architecture, which includes:

- **Admin Dashboard** (`apps/admin`) - Next.js 16 admin panel
- **Client Store** (`apps/client`) - Next.js 16 e-commerce storefront
- **Auth Service** (`apps/auth-service`) - Express-based authentication service

Sentry provides real-time error tracking, performance monitoring, and release health tracking across all environments (development, staging, production).

---

## Prerequisites

1. **Sentry Account**: Sign up at [sentry.io](https://sentry.io)
2. **Organization & Projects**: Create separate projects in Sentry for each app:
   - `neuraltale-admin`
   - `neuraltale-client`
   - `neuraltale-auth-service`
3. **DSNs**: Obtain Data Source Names (DSNs) for each project from Sentry dashboard

---

## Installation

### Step 1: Install Sentry SDKs

#### For Next.js Apps (Admin & Client)

```bash
# In apps/admin/
cd apps/admin
pnpm add @sentry/nextjs

# In apps/client/
cd apps/client
pnpm add @sentry/nextjs
```

#### For Express Auth Service

```bash
# In apps/auth-service/
cd apps/auth-service
pnpm add @sentry/node @sentry/express
```

### Step 2: Install Sentry CLI (for source maps & releases)

```bash
# Install globally or as dev dependency in root
pnpm add -D @sentry/cli -w
```

---

## Initialization with Environment-Specific DSNs

### Next.js Apps (Admin & Client)

#### 1. Create Sentry Configuration File

Create `apps/admin/sentry.client.config.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Set tracesSampleRate to capture 100% of transactions for performance monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  
  // Set profilingSampleRate for continuous profiling
  profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  
  // Environment configuration
  environment: process.env.NODE_ENV || "development",
  
  // Release configuration (set via CI/CD)
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  
  // Filter out health check and noise transactions
  ignoreTransactions: [
    "GET /api/health",
    "GET /api/robots",
    "GET /api/manifest",
  ],
  
  // beforeSend for filtering sensitive data
  beforeSend(event, hint) {
    // Remove sensitive data from error context
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-clerk-auth-token"];
    }
    
    // Remove PII from user context
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    
    return event;
  },
  
  // Enable React component error tracking
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  
  // Session Replay configuration
  replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,
});

export default Sentry;
```

Create `apps/admin/sentry.server.config.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  environment: process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  
  ignoreTransactions: [
    "GET /api/health",
    "GET /api/robots",
  ],
  
  beforeSendTransaction(event) {
    // Filter sensitive headers from transactions
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
    return event;
  },
});

export default Sentry;
```

Create `apps/admin/sentry.edge.config.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  environment: process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
});

export default Sentry;
```

#### 2. Create Instrumentation File

Create `apps/admin/instrumentation.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
```

#### 3. Update Next.js Configuration

Update `apps/admin/next.config.ts`:

```typescript
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Your existing config
  reactStrictMode: true,
};

const sentryConfig = {
  // Automatically create source maps
  sourcemaps: {
    disable: false,
    deleteSourcemapsAfterUpload: true,
  },
  
  // Enable Sentry SDK during build
  silent: !process.env.CI,
  
  // Telemetry opt-out
  telemetry: false,
  
  // Tunnel configuration for ad-blockers
  tunnelRoute: "/monitoring-tunnel",
  
  // Release configuration
  release: {
    name: process.env.SENTRY_RELEASE || `admin@${new Date().toISOString().split('T')[0]}`,
    create: true,
    setCommits: process.env.CI ? {
      auto: true,
      ignoreMissing: true,
    } : undefined,
    deploy: {
      env: process.env.NODE_ENV || "development",
    },
  },
  
  // Disable in development
  disableLogger: process.env.NODE_ENV === "development",
};

export default withSentryConfig(nextConfig, sentryConfig);
```

### Express Auth Service

Create `apps/auth-service/src/sentry.config.ts`:

```typescript
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";

export function initializeSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    
    // Profiling
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    
    // Filter sensitive data
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-api-key"];
      }
      
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      
      return event;
    },
    
    // Ignore health check routes
    ignoreTransactions: ["GET /health", "GET /ready"],
    
    integrations: [
      // Express integration
      Sentry.expressIntegration(),
      // HTTP client tracing
      Sentry.httpIntegration(),
    ],
  });
}
```

Update `apps/auth-service/src/index.ts`:

```typescript
import express from "express";
import * as Sentry from "@sentry/node";
import { initializeSentry } from "./sentry.config";

// Initialize Sentry first
initializeSentry();

const app = express();

// Add Sentry's request handler as first middleware
app.use(Sentry.Handlers.requestHandler());

// Add tracing middleware
app.use(Sentry.Handlers.tracingHandler());

// ... your existing routes and middleware

// Add error handler (must be last)
app.use(Sentry.Handlers.errorHandler({
  shouldHandleError(error) {
    // Capture all 500 errors
    return (error.status >= 500);
  },
}));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
```

---

## Source Map Configuration

### Why Source Maps Matter

Source maps allow Sentry to show your original TypeScript/JavaScript code in stack traces instead of minified production code.

### Next.js Source Map Setup

The `@sentry/nextjs` SDK automatically handles source maps. The configuration in `next.config.ts` above includes:

```typescript
sourcemaps: {
  disable: false,
  deleteSourcemapsAfterUpload: true,  // Security best practice
},
```

### Manual Source Map Upload (if needed)

Create a script in `apps/admin/scripts/upload-sourcemaps.sh`:

```bash
#!/bin/bash

# Upload source maps to Sentry
sentry-cli sourcemaps inject \
  --org neuraltale \
  --project neuraltale-admin \
  .next/static/chunks \
  .next/static/chunks

sentry-cli sourcemaps upload \
  --org neuraltale \
  --project neuraltale-admin \
  --release "$SENTRY_RELEASE" \
  .next/static/chunks
```

Make executable and run:

```bash
chmod +x apps/admin/scripts/upload-sourcemaps.sh
SENTRY_AUTH_TOKEN=your_token ./apps/admin/scripts/upload-sourcemaps.sh
```

### Express Service Source Maps

Update `apps/auth-service/package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "sourcemaps:inject": "sentry-cli sourcemaps inject ./dist",
    "sourcemaps:upload": "sentry-cli sourcemaps upload --release $SENTRY_RELEASE ./dist",
    "postbuild": "npm run sourcemaps:inject && npm run sourcemaps:upload"
  }
}
```

---

## Distributed Tracing & Performance Monitoring

### Next.js Distributed Tracing

The `@sentry/nextjs` SDK automatically instruments:

- Page loads
- API routes
- Server components
- Client-side navigation

To add custom tracing, create `apps/admin/src/lib/sentry-tracing.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

export function traceDatabaseQuery<T>(
  operation: string,
  collection: string,
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.startSpan(
    {
      name: `DB: ${operation} ${collection}`,
      op: "db.query",
      attributes: {
        "db.operation": operation,
        "db.collection": collection,
      },
    },
    () => fn()
  );
}

export function traceExternalApi<T>(
  serviceName: string,
  endpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.startSpan(
    {
      name: `API: ${serviceName} ${endpoint}`,
      op: "http.client",
      attributes: {
        "http.service": serviceName,
        "http.endpoint": endpoint,
      },
    },
    () => fn()
  );
}
```

Usage example in an API route:

```typescript
import { traceDatabaseQuery, traceExternalApi } from "@/lib/sentry-tracing";

export async function GET() {
  const products = await traceDatabaseQuery("find", "products", async () => {
    return await db.products.findMany();
  });
  
  const externalData = await traceExternalApi(
    "stripe",
    "/v1/products",
    async () => {
      return await stripe.products.list();
    }
  );
  
  return Response.json({ products, externalData });
}
```

### Express Service Tracing

Update `apps/auth-service/src/routes/user.route.ts`:

```typescript
import * as Sentry from "@sentry/node";
import { Router } from "express";

const router = Router();

router.get("/users", async (req, res) => {
  // Create a custom span for database operation
  const span = Sentry.startInactiveSpan({
    name: "fetch-users",
    op: "db.query",
    attributes: {
      "db.collection": "users",
      "db.operation": "find",
    },
  });
  
  try {
    const users = await db.users.findMany();
    span?.end();
    res.json(users);
  } catch (error) {
    span?.end();
    throw error;
  }
});

export default router;
```

---

## Automated Release Tracking

### CI/CD Integration

Create `.github/workflows/sentry-release.yml`:

```yaml
name: Sentry Release

on:
  push:
    branches: [main]

jobs:
  create-sentry-release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Create Sentry release
        uses: getsentry/action-release@v1
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: neuraltale
          SENTRY_PROJECT: neuraltale-admin
        with:
          environment: production
          version: ${{ github.sha }}
          projects: neuraltale-admin
          set_commits: true
          deploy_env: production
```

### Programmatic Release Tracking

Create `apps/admin/scripts/create-release.ts`:

```typescript
import { execSync } from "child_process";

const releaseName = process.env.SENTRY_RELEASE || `admin@${new Date().toISOString().split("T")[0]}`;
const environment = process.env.NODE_ENV || "development";

try {
  // Create release
  execSync(
    `sentry-cli releases new "${releaseName}" --project neuraltale-admin`,
    { stdio: "inherit" }
  );

  // Set commits
  execSync(
    `sentry-cli releases set-commits "${releaseName}" --auto --ignore-missing`,
    { stdio: "inherit" }
  );

  // Deploy
  execSync(
    `sentry-cli releases deploys "${releaseName}" new -e "${environment}"`,
    { stdio: "inherit" }
  );

  // Finalize
  execSync(
    `sentry-cli releases finalize "${releaseName}"`,
    { stdio: "inherit" }
  );

  console.log(`✅ Release ${releaseName} created for ${environment}`);
} catch (error) {
  console.error("❌ Failed to create Sentry release:", error);
  process.exit(1);
}
```

Add to `package.json`:

```json
{
  "scripts": {
    "sentry:release": "ts-node scripts/create-release.ts"
  }
}
```

---

## Filtering Sensitive Data

### Global beforeSend Configuration

Add to all Sentry configs:

```typescript
beforeSend(event, hint) {
  // Remove authorization headers
  if (event.request?.headers) {
    const sensitiveHeaders = [
      "authorization",
      "cookie",
      "x-api-key",
      "x-clerk-auth-token",
      "x-csrf-token",
    ];
    
    sensitiveHeaders.forEach(header => {
      delete event.request.headers[header];
    });
  }
  
  // Remove PII from user context
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  
  // Scrub sensitive data from breadcrumbs
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
      if (breadcrumb.data) {
        // Remove sensitive data from HTTP breadcrumbs
        if (breadcrumb.data.url) {
          const url = new URL(breadcrumb.data.url);
          // Remove query parameters that might contain tokens
          url.searchParams.delete("token");
          url.searchParams.delete("api_key");
          breadcrumb.data.url = url.toString();
        }
      }
      return breadcrumb;
    });
  }
  
  // Remove request body if it contains sensitive data
  if (event.request?.data) {
    const sensitiveFields = ["password", "credit_card", "ssn", "token"];
    const data = event.request.data;
    
    if (typeof data === "object") {
      sensitiveFields.forEach(field => {
        delete data[field];
      });
    }
  }
  
  return event;
}
```

### Route-Specific Filtering

For API routes that handle sensitive data:

```typescript
import * as Sentry from "@sentry/nextjs";

export async function POST(request: Request) {
  const body = await request.json();
  
  // Add breadcrumb without sensitive data
  Sentry.addBreadcrumb({
    category: "api.request",
    message: `POST /api/orders`,
    level: "info",
    data: {
      // Only include non-sensitive data
      orderId: body.orderId,
      itemCount: body.items?.length,
      // NEVER include: credit card, password, tokens
    },
  });
  
  // Process order...
}
```

---

## Environment Variable Management

### Required Environment Variables

Create `.env.example` in each app:

#### apps/admin/.env.example

```bash
# Sentry Configuration
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0
SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=neuraltale
SENTRY_PROJECT=neuraltale-admin

# Environment
NODE_ENV=development
NEXT_PUBLIC_BASE_URL=http://localhost:3003
```

#### apps/client/.env.example

```bash
# Sentry Configuration
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0
SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=neuraltale
SENTRY_PROJECT=neuraltale-client

# Environment
NODE_ENV=development
NEXT_PUBLIC_BASE_URL=http://localhost:3004
```

#### apps/auth-service/.env.example

```bash
# Sentry Configuration
SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=neuraltale
SENTRY_PROJECT=neuraltale-auth-service

# Environment
NODE_ENV=development
PORT=3001
```

### Environment-Specific DSNs

Create environment files:

#### .env.development

```bash
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
# Leave empty to disable Sentry in development
```

#### .env.staging

```bash
NEXT_PUBLIC_SENTRY_DSN=https://staging-dsn@sentry.io/project-id
SENTRY_DSN=https://staging-dsn@sentry.io/project-id
```

#### .env.production

```bash
NEXT_PUBLIC_SENTRY_DSN=https://production-dsn@sentry.io/project-id
SENTRY_DSN=https://production-dsn@sentry.io/project-id
```

### Conditional Initialization

Update Sentry configs to handle missing DSNs:

```typescript
import * as Sentry from "@sentry/nextjs";

// Only initialize if DSN is provided
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // ... rest of config
  });
}

export default Sentry;
```

---

## Custom Error Boundaries & Breadcrumbs

### Updated Error Boundary with Sentry

Update `apps/admin/src/app/error.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RefreshCcw, ArrowLeft, LifeBuoy } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to Sentry
    Sentry.captureException(error, {
      tags: {
        component: "ErrorBoundary",
        page: "admin",
      },
      contexts: {
        react: {
          componentStack: error.stack,
        },
      },
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full">
        {/* Error Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-12 text-center border border-slate-200">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg">
              <AlertTriangle className="w-10 h-10 text-white" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Admin Panel Error
          </h1>

          {/* Description */}
          <p className="text-gray-600 mb-2 text-lg">
            An unexpected error occurred in the admin dashboard.
          </p>
          <p className="text-gray-500 text-sm mb-8">
            The system has logged this error for investigation.
          </p>

          {/* Error Details (Development only) */}
          {process.env.NODE_ENV === "development" && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-8 text-left">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <p className="text-sm font-semibold text-red-800">
                  Error Details (Development Mode)
                </p>
              </div>
              <div className="bg-red-100 rounded p-3">
                <p className="text-xs text-red-900 font-mono break-all">
                  {error.message || "Unknown error"}
                </p>
                {error.stack && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-700 cursor-pointer hover:text-red-900">
                      Stack Trace
                    </summary>
                    <pre className="text-xs text-red-800 mt-2 overflow-auto max-h-40">
                      {error.stack}
                    </pre>
                  </details>
                )}
              </div>
              {error.digest && (
                <p className="text-xs text-red-600 mt-2 font-medium">
                  Error ID: {error.digest}
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={() => {
                reset();
                Sentry.addBreadcrumb({
                  category: "user.action",
                  message: "User clicked 'Try Again'",
                  level: "info",
                });
              }}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-[#001E3C] to-[#0A7EA4] hover:from-[#0A7EA4] hover:to-[#001E3C] text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <RefreshCcw className="w-5 h-5" />
              Try Again
            </button>

            <Link
              href="/"
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <Home className="w-5 h-5" />
              Dashboard Home
            </Link>

            <button
              onClick={() => window.history.back()}
              className="w-full sm:w-auto px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border-2 border-gray-300 hover:border-gray-400 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Go Back
            </button>
          </div>

          {/* Admin Help Section */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <div className="flex items-center justify-center gap-2 mb-3">
              <LifeBuoy className="w-5 h-5 text-[#0A7EA4]" />
              <p className="text-sm font-semibold text-gray-700">
                Need Technical Support?
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                For urgent issues, contact the technical team:
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center items-center text-sm">
                <a
                  href="mailto:admin@neuraltale.com"
                  className="text-[#0A7EA4] hover:text-[#001E3C] font-medium underline"
                >
                  admin@neuraltale.com
                </a>
                <span className="hidden sm:inline text-gray-400">|</span>
                <a
                  href="tel:+1234567890"
                  className="text-[#0A7EA4] hover:text-[#001E3C] font-medium underline"
                >
                  +255 653 520 829
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            Error Code: {error.digest || "UNKNOWN"} | Neuraltale Admin Panel
            v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
```

### Custom Breadcrumb Helper

Create `apps/admin/src/lib/sentry-breadcrumbs.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

export function addNavigationBreadcrumb(from: string, to: string) {
  Sentry.addBreadcrumb({
    category: "navigation",
    message: `Navigated from ${from} to ${to}`,
    level: "info",
    data: {
      from,
      to,
    },
  });
}

export function addApiBreadcrumb(
  method: string,
  endpoint: string,
  status?: number
) {
  Sentry.addBreadcrumb({
    category: "api",
    message: `${method} ${endpoint} ${status ? `(${status})` : ""}`,
    level: status && status >= 400 ? "warning" : "info",
    data: {
      method,
      endpoint,
      status,
    },
  });
}

export function addUserBreadcrumb(action: string, userId?: string) {
  Sentry.addBreadcrumb({
    category: "user.action",
    message: `User ${action}`,
    level: "info",
    data: {
      action,
      userId: userId ? `user_${userId.slice(-8)}` : "anonymous", // Truncate for privacy
    },
  });
}

export function addDatabaseBreadcrumb(
  operation: string,
  collection: string,
  count?: number
) {
  Sentry.addBreadcrumb({
    category: "db",
    message: `DB ${operation} on ${collection}${count ? ` (${count} results)` : ""}`,
    level: "info",
    data: {
      operation,
      collection,
      count,
    },
  });
}
```

### Usage in Components

```typescript
import { addApiBreadcrumb, addUserBreadcrumb } from "@/lib/sentry-breadcrumbs";

export async function deleteProduct(id: string) {
  addUserBreadcrumb("delete_product", getCurrentUserId());
  
  try {
    const result = await fetch(`/api/products/${id}`, { method: "DELETE" });
    addApiBreadcrumb("DELETE", `/api/products/${id}`, result.status);
    return result.json();
  } catch (error) {
    addApiBreadcrumb("DELETE", `/api/products/${id}`, 500);
    throw error;
  }
}
```

---

## Test Error Verification

### Create Test Error Endpoint

Create `apps/admin/src/app/api/test-error/route.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET() {
  // Test 1: Simple error capture
  try {
    throw new Error("This is a test error from the admin API");
  } catch (error) {
    Sentry.captureException(error, {
      tags: { test: true },
      level: "error",
    });
  }

  // Test 2: Custom message with extra context
  Sentry.captureMessage("Test message from admin API", {
    level: "info",
    tags: { test: true },
    extra: {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      testData: { foo: "bar" },
    },
  });

  // Test 3: Transaction tracing
  const transaction = Sentry.startInactiveSpan({
    name: "test-transaction",
    op: "test.operation",
  });
  
  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100));
  transaction.end();

  return NextResponse.json({
    message: "Test errors sent to Sentry",
    timestamp: new Date().toISOString(),
  });
}
```

### Client-Side Test Error

Create `apps/admin/src/components/TestErrorButton.tsx`:

```typescript
"use client";

import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export function TestErrorButton() {
  const triggerError = () => {
    try {
      throw new Error("Test error from admin UI component");
    } catch (error) {
      Sentry.captureException(error, {
        tags: { test: true, component: "TestErrorButton" },
        extra: {
          userAgent: navigator.userAgent,
          url: window.location.href,
        },
      });
    }
  };

  return (
    <Button
      onClick={triggerError}
      variant="destructive"
      className="fixed bottom-4 right-4 z-50"
    >
      Test Sentry Error
    </Button>
  );
}
```

### Verification Steps

1. **Deploy to staging** with test endpoint
2. **Call the test endpoint**: `curl https://staging-admin.neuraltale.com/api/test-error`
3. **Check Sentry Dashboard**:
   - Navigate to Issues
   - Look for "This is a test error from the admin API"
   - Verify stack trace shows original TypeScript code (not minified)
   - Check that environment is correctly set
   - Verify breadcrumbs are present
4. **Check Performance**:
   - Navigate to Performance
   - Verify transactions are being recorded
   - Check that traces show correct spans

---

## Troubleshooting Common Issues

### Issue 1: "Sentry SDK not initialized"

**Symptoms**: Errors not appearing in Sentry dashboard

**Solutions**:
```bash
# Verify DSN is set
echo $NEXT_PUBLIC_SENTRY_DSN
echo $SENTRY_DSN

# Check environment file is loaded
cat .env.production | grep SENTRY

# Verify Sentry is initialized in code
# Add console.log in sentry.config.ts
console.log("Sentry DSN:", process.env.NEXT_PUBLIC_SENTRY_DSN);
```

### Issue 2: Source Maps Not Working

**Symptoms**: Stack traces show minified code

**Solutions**:
```bash
# Verify source maps are generated
ls -la .next/static/chunks/*.map

# Check Sentry CLI is authenticated
sentry-cli auth login

# Verify release matches
echo $SENTRY_RELEASE

# Manually upload source maps
sentry-cli sourcemaps upload \
  --org neuraltale \
  --project neuraltale-admin \
  --release $SENTRY_RELEASE \
  .next/static/chunks
```

### Issue 3: Errors Not Appearing in Production

**Symptoms**: Works in staging, not in production

**Solutions**:
```bash
# Check if Sentry is disabled in production config
grep -r "enabled" sentry*.config.ts

# Verify DSN is correct (no typos)
echo $SENTRY_DSN

# Check network requests in browser dev tools
# Look for POST to sentry.io being blocked by CSP
```

### Issue 4: Too Many Errors / Noise

**Symptoms**: Sentry flooded with non-critical errors

**Solutions**:
```typescript
// Add to Sentry config
ignoreErrors: [
  "ResizeObserver loop limit exceeded",
  "Non-Error promise rejection captured",
  "Loading chunk",
  "ChunkLoadError",
],

ignoreTransactions: [
  "GET /api/health",
  "GET /api/robots",
  "OPTIONS *",
],

// Filter by error type
beforeSend(event) {
  // Ignore 4xx errors
  if (event.exception?.values?.[0]?.value?.includes("404")) {
    return null;
  }
  return event;
}
```

### Issue 5: Performance Impact

**Symptoms**: App slowdown after Sentry integration

**Solutions**:
```typescript
// Reduce sample rates in production
tracesSampleRate: 0.1,  // 10% of transactions
profilesSampleRate: 0.1,
replaysSessionSampleRate: 0.1,

// Use tunneling to avoid ad-blockers
tunnelRoute: "/monitoring-tunnel",

// Disable in development
enabled: process.env.NODE_ENV !== "development",
```

### Issue 6: CORS Errors with Sentry

**Symptoms**: Browser blocks Sentry requests

**Solutions**:
```typescript
// Use tunneling in next.config.ts
const sentryConfig = {
  tunnelRoute: "/monitoring-tunnel",
};

// Or use a custom proxy
// Create /monitoring-tunnel route that forwards to Sentry
```

---

## Environment-Specific Configurations

### Development Environment

```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,  // Disabled if DSN empty
  tracesSampleRate: 1.0,  // Full sampling for testing
  environment: "development",
  debug: true,  // Enable debug logging
});
```

**.env.development**:
```bash
# Leave empty to disable Sentry in development
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
```

### Staging Environment

```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: true,
  tracesSampleRate: 0.5,  // 50% sampling
  environment: "staging",
  debug: false,
});
```

**.env.staging**:
```bash
NEXT_PUBLIC_SENTRY_DSN=https://staging-dsn@sentry.io/project-id
SENTRY_DSN=https://staging-dsn@sentry.io/project-id
SENTRY_RELEASE=staging@$(git rev-parse --short HEAD)
```

### Production Environment

```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: true,
  tracesSampleRate: 0.1,  // 10% sampling to manage costs
  profilesSampleRate: 0.1,
  environment: "production",
  debug: false,
  release: process.env.SENTRY_RELEASE,
  
  // Production-specific filtering
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Loading chunk",
  ],
  
  beforeSend(event) {
    // Extra production filtering
    if (event.user?.email) {
      delete event.user.email;
    }
    return event;
  },
});
```

**.env.production**:
```bash
NEXT_PUBLIC_SENTRY_DSN=https://production-dsn@sentry.io/project-id
SENTRY_DSN=https://production-dsn@sentry.io/project-id
SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
SENTRY_RELEASE=production@$(git rev-parse --short HEAD)
SENTRY_ORG=neuraltale
SENTRY_PROJECT=neuraltale-admin
```

---

## Quick Reference

### File Structure

```
apps/admin/
├── sentry.client.config.ts    # Client-side Sentry config
├── sentry.server.config.ts    # Server-side Sentry config
├── sentry.edge.config.ts      # Edge runtime Sentry config
├── instrumentation.ts         # Next.js instrumentation
├── next.config.ts             # Updated with Sentry config
└── src/
    ├── app/
    │   └── error.tsx          # Error boundary with Sentry
    └── lib/
        ├── sentry-tracing.ts  # Custom tracing helpers
        └── sentry-breadcrumbs.ts  # Breadcrumb helpers

apps/auth-service/
├── src/
│   ├── sentry.config.ts       # Sentry configuration
│   └── index.ts               # Updated with Sentry middleware
```

### Environment Variables Summary

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side DSN | Yes (client) |
| `SENTRY_DSN` | Server-side DSN | Yes (server) |
| `SENTRY_AUTH_TOKEN` | CLI authentication token | Yes (CI/CD) |
| `SENTRY_ORG` | Sentry organization slug | Yes |
| `SENTRY_PROJECT` | Sentry project name | Yes |
| `SENTRY_RELEASE` | Release version | Recommended |
| `NODE_ENV` | Environment name | Yes |

### Common Commands

```bash
# Install Sentry SDKs
pnpm add @sentry/nextjs  # Next.js apps
pnpm add @sentry/node @sentry/express  # Express apps

# Authenticate Sentry CLI
sentry-cli auth login

# Create release
sentry-cli releases new "release-name"

# Upload source maps
sentry-cli sourcemaps upload --release "release-name" ./dist

# Set commits
sentry-cli releases set-commits "release-name" --auto

# Create deploy
sentry-cli releases deploys "release-name" new -e production
```

---

## Additional Resources

- [Sentry Next.js Documentation](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry Node.js Documentation](https://docs.sentry.io/platforms/node/)
- [Sentry Express Integration](https://docs.sentry.io/platforms/node/guides/express/)
- [Source Maps Guide](https://docs.sentry.io/platforms/javascript/sourcemaps/)
- [Performance Monitoring](https://docs.sentry.io/platforms/javascript/guides/nextjs/performance/)
- [Release Health](https://docs.sentry.io/product/releases/)

---

*Last updated: 2026-04-04*
*Version: 1.0.0*
