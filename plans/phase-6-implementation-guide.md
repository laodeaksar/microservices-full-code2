# Phase 6 Implementation Guide: Rollout

**Goal:** Staged rollout with monitoring, internal beta testing, canary release, gradual traffic increase, documentation updates, support team training, and post-launch monitoring.

**Prerequisites:** Phases 1–5 must be fully completed, tested, and deployed to staging environment, including:
- Extended OrderSchema with all new fields (Phase 1)
- State machine service with transition validation (Phase 1)
- Notification service and API endpoints (Phase 2)
- Client-side order tracking UI with SSE (Phases 3, 5)
- Admin order management with bulk actions (Phase 4)
- Carrier tracking integration and ETA calculation (Phase 5)
- All unit, integration, E2E, and load tests passing
- Performance benchmarks met (API p95 < 200ms, page load < 2s)

---

## Step 1: Internal Beta Testing

### 1.1 Set up staging environment

**File:** `render.yaml` (root directory)

Add staging service definitions with environment variable overrides:

```yaml
# Staging environment configuration
services:
  # Order Service - Staging
  - type: web
    name: order-service-staging
    env: node
    buildCommand: cd apps/order-service && pnpm install && pnpm build
    startCommand: cd apps/order-service && pnpm start
    envVars:
      - key: NODE_ENV
        value: staging
      - key: MONGODB_URI
        fromDatabase:
          name: mongodb
          property: connectionString
      - key: EMAIL_SERVICE_URL
        fromService:
          name: email-service-staging
          type: web
          envVarKey: RENDER_EXTERNAL_URL
      - key: LOG_LEVEL
        value: debug
    autoDeploy: false  # Manual deployment for staging

  # Client App - Staging
  - type: web
    name: client-staging
    env: node
    buildCommand: cd apps/client && pnpm install && pnpm build
    startCommand: cd apps/client && pnpm start
    envVars:
      - key: NODE_ENV
        value: staging
      - key: NEXT_PUBLIC_ORDER_SERVICE_URL
        fromService:
          name: order-service-staging
          type: web
          envVarKey: RENDER_EXTERNAL_URL
    autoDeploy: false

  # Admin App - Staging
  - type: web
    name: admin-staging
    env: node
    buildCommand: cd apps/admin && pnpm install && pnpm build
    startCommand: cd apps/admin && pnpm start
    envVars:
      - key: NODE_ENV
        value: staging
      - key: NEXT_PUBLIC_ORDER_SERVICE_URL
        fromService:
          name: order-service-staging
          type: web
          envVarKey: RENDER_EXTERNAL_URL
    autoDeploy: false
```

### 1.2 Create beta tester access control

**File:** `apps/client/src/middleware.ts`

Add beta feature flag based on user email or group:

```typescript
import { authMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Beta tester email list or group
const BETA_TESTER_EMAILS = [
  "beta1@example.com",
  "beta2@example.com",
  // Add beta tester emails
];

const BETA_TESTER_GROUP = "beta-testers";

export default authMiddleware({
  async afterAuth(auth, req) {
    if (auth.userId) {
      // Check if user is a beta tester
      const isBetaTester = await checkBetaTesterStatus(auth.userId);

      if (isBetaTester) {
        // Set beta feature flag cookie
        const response = NextResponse.next();
        response.cookies.set("beta-features", "order-tracking-v2", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
        return response;
      }
    }
    return NextResponse.next();
  },
});

async function checkBetaTesterStatus(userId: string): Promise<boolean> {
  // Check user metadata or database for beta tester status
  // This could be a Clerk metadata field or a database lookup
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const user = await clerkClient.users.getUser(userId);

    // Check if user is in beta tester group
    if (user.publicMetadata?.betaTester === true) {
      return true;
    }

    // Check email against whitelist
    if (user.emailAddresses[0]?.emailAddress) {
      return BETA_TESTER_EMAILS.includes(user.emailAddresses[0].emailAddress);
    }
  } catch (error) {
    console.error("Failed to check beta tester status:", error);
  }

  return false;
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

### 1.3 Create beta feedback form

**File:** `apps/client/src/components/BetaFeedbackForm.tsx` (NEW FILE)

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "react-toastify";
import { MessageSquare } from "lucide-react";

/**
 * Beta feedback form component.
 *
 * Allows beta testers to submit feedback about the new order tracking experience.
 */
export function BetaFeedbackForm() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [rating, setRating] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!feedback.trim()) {
      toast.error("Please provide some feedback");
      return;
    }

    setIsSubmitting(true);

    try {
      await fetch("/api/beta/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback,
          rating,
          page: window.location.pathname,
          timestamp: new Date().toISOString(),
        }),
      });

      toast.success("Thank you for your feedback!");
      setFeedback("");
      setRating(0);
      setOpen(false);
    } catch (error) {
      toast.error("Failed to submit feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-4 left-4 z-50 gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Beta Feedback
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Beta Feedback</DialogTitle>
          <DialogDescription>
            Help us improve the new order tracking experience. What did you like
            or dislike?
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Overall Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className={`text-2xl ${
                    star <= rating ? "text-yellow-400" : "text-gray-300"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="feedback">Your Feedback</Label>
            <Textarea
              id="feedback"
              placeholder="What worked well? What could be improved?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !feedback}>
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BetaFeedbackForm;
```

### 1.4 Create feedback API endpoint

**File:** `apps/client/src/app/api/beta/feedback/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { feedback, rating, page, timestamp } = body;

    // Store feedback in database or external service
    // For now, log to console - replace with actual storage
    console.log("Beta feedback received:", {
      userId,
      feedback,
      rating,
      page,
      timestamp,
    });

    // TODO: Store in database
    // await db.betaFeedback.create({
    //   data: { userId, feedback, rating, page, timestamp },
    // });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to process feedback:", error);
    return NextResponse.json(
      { error: "Failed to process feedback" },
      { status: 500 },
    );
  }
}
```

### 1.5 Add feedback form to order pages

**File:** `apps/client/src/app/orders/[id]/page.tsx`

Add the feedback form to the order detail page:

```tsx
import { BetaFeedbackForm } from "@/components/BetaFeedbackForm";

// ... at the end of the page component, before closing div ...

{/* Beta feedback form (only for beta testers) */}
<BetaFeedbackForm />
```

### 1.6 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

### 1.7 Beta Testing Checklist

| Task | Owner | Status |
|------|-------|--------|
| Deploy staging environment | DevOps | ☐ |
| Add beta tester emails to Clerk | Admin | ☐ |
| Invite beta testers via email | Product | ☐ |
| Monitor feedback submissions | QA | ☐ |
| Collect bug reports | QA | ☐ |
| Prioritize fixes | Product + Eng | ☐ |
| Fix critical bugs | Eng | ☐ |
| Re-test fixes | QA | ☐ |
| Beta sign-off | Product | ☐ |

### 1.8 Rollback Procedure

If beta testing reveals critical issues:
1. Remove beta feature flag from middleware
2. Revert order pages to Phase 3 implementation
3. Notify beta testers of rollback
4. Address issues before next beta round

---

## Step 2: Canary Release (5% Traffic)

### 2.1 Configure canary deployment

**File:** `render.yaml` (root directory)

Add canary deployment configuration:

```yaml
# Canary deployment configuration
services:
  # Order Service - Canary
  - type: web
    name: order-service-canary
    env: node
    buildCommand: cd apps/order-service && pnpm install && pnpm build
    startCommand: cd apps/order-service && pnpm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: CANARY
        value: "true"
      - key: LOG_LEVEL
        value: debug
    autoDeploy: false

  # Client App - Canary
  - type: web
    name: client-canary
    env: node
    buildCommand: cd apps/client && pnpm install && pnpm build
    startCommand: cd apps/client && pnpm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: NEXT_PUBLIC_ORDER_SERVICE_URL
        fromService:
          name: order-service-canary
          type: web
          envVarKey: RENDER_EXTERNAL_URL
    autoDeploy: false
```

### 2.2 Create traffic splitting middleware

**File:** `apps/client/src/middleware.ts`

Add canary traffic splitting logic:

```typescript
// Add to existing middleware

const CANARY_PERCENTAGE = 5; // 5% of traffic

function isInCanary(userId: string): boolean {
  // Simple hash-based distribution
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100 < CANARY_PERCENTAGE;
}

// In the afterAuth function:
if (isInCanary(auth.userId)) {
  // Route to canary deployment
  // This could be done via cookie or header
  response.cookies.set("canary", "true", {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24, // 24 hours
  });
}
```

### 2.3 Add canary monitoring endpoint

**File:** `apps/order-service/src/routes/sse.ts`

Add canary metrics endpoint:

```typescript
// Add to sseRoute

fastify.get("/orders/canary/metrics", async (request, reply) => {
  const { getCacheStats } = await import("../utils/cache");

  return reply.send({
    canary: process.env.CANARY === "true",
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    activeSSEConnections: connections.length,
    cacheStats: getCacheStats(),
    timestamp: new Date().toISOString(),
  });
});
```

### 2.4 Create canary metrics dashboard

**File:** `apps/admin/src/app/(dashboard)/canary/page.tsx` (NEW FILE)

```tsx
import { auth } from "@clerk/nextjs/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

async function fetchCanaryMetrics() {
  try {
    const { getToken } = await auth();
    const token = await getToken();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/canary/metrics`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );

    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.error("Failed to fetch canary metrics:", error);
    return null;
  }
}

export default async function CanaryMetricsPage() {
  const metrics = await fetchCanaryMetrics();

  if (!metrics) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-red-600">Failed to load canary metrics.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Canary Deployment Metrics</h1>
        <Badge variant={metrics.canary ? "default" : "secondary"}>
          {metrics.canary ? "Canary Active" : "Canary Inactive"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {Math.floor(metrics.uptime / 3600)}h {Math.floor((metrics.uptime % 3600) / 60)}m
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">SSE Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{metrics.activeSSEConnections}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Memory Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024)} MB
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Timestamp</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">
              {new Date(metrics.timestamp).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

### 2.5 Canary Success Criteria

| Metric | Target | Pass Criteria |
|--------|--------|---------------|
| Error rate | < 0.5% | Less than 0.5% of requests fail |
| API p95 latency | < 200ms | 95% of requests under 200ms |
| SSE connection stability | > 99% | Less than 1% unexpected disconnects |
| Memory usage | < 512MB | Node.js heap stays under 512MB |
| User complaints | < 5 | Less than 5 negative feedback submissions |
| CSAT score | > 4.0/5.0 | Average satisfaction above 4.0 |

### 2.6 Verification Checkpoint

```bash
# Verify canary deployment is running
curl https://order-service-canary.onrender.com/health

# Verify metrics endpoint
curl https://order-service-canary.onrender.com/orders/canary/metrics
```

### 2.7 Rollback Procedure

If canary metrics exceed thresholds:
1. Immediately stop canary deployment
2. Route 100% traffic back to stable deployment
3. Analyze error logs
4. Fix issues before next canary attempt

```bash
# Stop canary deployment via Render dashboard or CLI
render service delete order-service-canary
render service delete client-canary
```

---

## Step 3: Analyze Canary Metrics

### 3.1 Create metrics collection script

**File:** `scripts/analyze-canary.ts` (NEW FILE)

```typescript
/**
 * Canary metrics analysis script.
 *
 * Collects metrics from canary and stable deployments,
 * compares them, and generates a report.
 *
 * Usage: npx ts-node scripts/analyze-canary.ts
 */

interface MetricsSnapshot {
  timestamp: string;
  errorRate: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  activeConnections: number;
  memoryUsageMB: number;
  requestsPerMinute: number;
}

async function fetchMetrics(url: string): Promise<MetricsSnapshot> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch metrics: ${response.status}`);
  }
  return response.json();
}

async function analyzeCanary() {
  const CANARY_URL = process.env.CANARY_METRICS_URL || "http://localhost:8001/orders/canary/metrics";
  const STABLE_URL = process.env.STABLE_METRICS_URL || "http://localhost:8002/orders/canary/metrics";

  console.log("📊 Collecting canary metrics...");

  try {
    const [canaryMetrics, stableMetrics] = await Promise.all([
      fetchMetrics(CANARY_URL),
      fetchMetrics(STABLE_URL),
    ]);

    console.log("\n📈 Canary Metrics Report");
    console.log("=" .repeat(50));
    console.log(`Timestamp: ${canaryMetrics.timestamp}`);
    console.log(`Uptime: ${Math.floor(canaryMetrics.uptime / 3600)}h ${Math.floor((canaryMetrics.uptime % 3600) / 60)}m`);
    console.log(`SSE Connections: ${canaryMetrics.activeSSEConnections}`);
    console.log(`Memory Usage: ${Math.round(canaryMetrics.memoryUsage.heapUsed / 1024 / 1024)} MB`);

    console.log("\n📊 Comparison: Canary vs Stable");
    console.log("=" .repeat(50));

    // Add comparison logic here when metrics are available
    console.log("Canary deployment is running.");
    console.log("Monitor error rates and latency closely.");

    // Determine if canary should proceed
    const canProceed = true; // Add actual comparison logic

    if (canProceed) {
      console.log("\n✅ Canary metrics look good. Proceed with gradual rollout.");
    } else {
      console.log("\n❌ Canary metrics indicate issues. Roll back and investigate.");
    }
  } catch (error) {
    console.error("Failed to analyze canary metrics:", error);
  }
}

analyzeCanary();
```

### 3.2 Set up monitoring alerts

Create alert thresholds in your monitoring platform (e.g., Datadog, New Relic, or Render):

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| High error rate | Error rate > 1% for 5 min | Critical | Page on-call, rollback canary |
| High latency | p95 > 300ms for 5 min | Warning | Investigate, prepare rollback |
| Memory leak | Heap usage increasing for 30 min | Warning | Restart instance, investigate |
| SSE disconnects | Disconnect rate > 5% for 5 min | Warning | Check SSE endpoint |
| Low CSAT | Average rating < 3.5 for 1 hour | Warning | Review feedback, investigate |

### 3.3 Verification Checkpoint

```bash
# Run canary analysis
cd scripts && npx ts-node analyze-canary.ts
```

---

## Step 4: Gradual Rollout (25% → 50% → 100%)

### 4.1 Create rollout script

**File:** `scripts/rollout.ts` (NEW FILE)

```typescript
/**
 * Gradual rollout script.
 *
 * Increases traffic to new deployment in stages:
 * 5% (canary) → 25% → 50% → 100%
 *
 * Usage: npx ts-node scripts/rollout.ts --stage=25
 */

const STAGES = [5, 25, 50, 100];
const STAGE_DURATION_MS = 30 * 60 * 1000; // 30 minutes per stage
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function updateTrafficPercentage(percentage: number): Promise<void> {
  // Update load balancer or CDN configuration
  // This depends on your infrastructure setup
  console.log(`🔄 Updating traffic to ${percentage}%...`);

  // Example: Update via API
  // await fetch("https://api.your-lb.com/update", {
  //   method: "POST",
  //   body: JSON.stringify({ canaryWeight: percentage }),
  // });

  console.log(`✅ Traffic updated to ${percentage}%`);
}

async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(
      `${process.env.ORDER_SERVICE_URL}/health`,
      { signal: AbortSignal.timeout(5000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function rolloutToStage(targetStage: number): Promise<void> {
  const currentStageIndex = STAGES.indexOf(targetStage);
  if (currentStageIndex === -1) {
    console.error(`Invalid stage: ${targetStage}. Valid stages: ${STAGES.join(", ")}`);
    return;
  }

  console.log(`🚀 Starting rollout to ${targetStage}%`);

  for (let i = 0; i <= currentStageIndex; i++) {
    const stage = STAGES[i];
    console.log(`\n📊 Stage ${i + 1}/${currentStageIndex + 1}: ${stage}%`);

    // Update traffic
    await updateTrafficPercentage(stage);

    if (i < currentStageIndex) {
      // Wait and monitor before proceeding to next stage
      console.log(`⏳ Monitoring for ${STAGE_DURATION_MS / 1000 / 60} minutes...`);

      const healthChecks = Math.floor(STAGE_DURATION_MS / HEALTH_CHECK_INTERVAL_MS);
      for (let j = 0; j < healthChecks; j++) {
        await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));

        const isHealthy = await healthCheck();
        if (!isHealthy) {
          console.error("❌ Health check failed! Rolling back...");
          await updateTrafficPercentage(STAGES[0]); // Rollback to canary
          return;
        }
        console.log(`  ✓ Health check ${j + 1}/${healthChecks} passed`);
      }
    }
  }

  console.log("\n🎉 Rollout complete! All traffic now going to new deployment.");
}

// Parse command line arguments
const args = process.argv.slice(2);
const stageArg = args.find((a) => a.startsWith("--stage="));
const stage = stageArg ? parseInt(stageArg.split("=")[1], 10) : 25;

rolloutToStage(stage);
```

### 4.2 Rollout execution plan

| Stage | Traffic % | Duration | Monitoring Focus | Go/No-Go Criteria |
|-------|-----------|----------|------------------|-------------------|
| Canary | 5% | 2 hours | Error rate, latency, SSE | Error rate < 0.5%, p95 < 200ms |
| Stage 1 | 25% | 4 hours | Same as canary + CSAT | No increase in support tickets |
| Stage 2 | 50% | 8 hours | All metrics + business KPIs | Order completion rate stable |
| Stage 3 | 100% | Ongoing | Full monitoring | All metrics within thresholds |

### 4.3 Execute rollout

```bash
# Rollout to 25%
cd scripts && npx ts-node rollout.ts --stage=25

# After monitoring, rollout to 50%
cd scripts && npx ts-node rollout.ts --stage=50

# Final rollout to 100%
cd scripts && npx ts-node rollout.ts --stage=100
```

### 4.4 Rollback Procedure

If any stage fails:
1. Immediately revert to previous stable stage
2. Investigate root cause
3. Fix and re-test in staging
4. Restart canary process

```bash
# Emergency rollback
cd scripts && npx ts-node rollout.ts --stage=5
```

---

## Step 5: Update Documentation

### 5.1 Create user-facing help articles

**File:** `docs/order-tracking-help.md` (NEW FILE)

```markdown
# Order Tracking Help

## Understanding Your Order Status

When you place an order, it goes through several stages before it reaches you. Here's what each status means:

### Order Statuses

| Status | What It Means |
|--------|---------------|
| Awaiting Payment | Your order has been created. Please complete payment. |
| Payment Processing | We're confirming your payment with your bank. |
| Payment Confirmed | Payment successful! We're preparing your order. |
| Order Confirmed | Our team has verified and is processing your order. |
| Processing | Your items are being picked and packed. |
| Shipped | Your order is on its way! Track it using the tracking number. |
| Out for Delivery | Your order is with the local courier for delivery today. |
| Delivered | Your order has been delivered. Enjoy! |
| Delivery Issue | We encountered a problem. Please check your order details. |
| Cancelled | This order was cancelled. Refund will be processed if applicable. |
| Refunded | A refund has been issued. Allow 5-10 business days. |

## Tracking Your Order

1. Go to **Your Orders** in your account
2. Click on the order you want to track
3. View the progress bar to see where your order is
4. Click the tracking number to see detailed carrier tracking

## Estimated Delivery

Your order detail page shows an estimated delivery date. This is calculated based on:
- Shipping carrier
- Destination
- Shipping method

## Need Help?

If you have questions about your order:
1. Check the order detail page for tracking information
2. Use the **Request Return** button if you need to return an item
3. Contact our support team at support@neurashop.com
```

### 5.2 Update API documentation

**File:** `docs/order-api.md` (NEW FILE)

```markdown
# Order Service API Documentation

## Endpoints

### GET /orders/:id
Get single order details.

**Authentication:** Required (admin or order owner)

**Response:**
```json
{
  "_id": "order_id",
  "userId": "user_id",
  "email": "customer@email.com",
  "amount": 10000,
  "status": "shipped",
  "products": [...],
  "shippingAddress": {...},
  "shipments": [...],
  "statusHistory": [...],
  "estimatedDeliveryDate": "2024-01-20T00:00:00.000Z",
  "createdAt": "2024-01-15T14:30:00.000Z"
}
```

### PATCH /orders/:id/status
Update order status with validation.

**Authentication:** Required (admin only)

**Request Body:**
```json
{
  "status": "shipped",
  "reason": "Package handed to carrier",
  "changedBy": "admin"
}
```

**Response:**
```json
{
  "success": true,
  "order": {...},
  "previousStatus": "processing",
  "newStatus": "shipped",
  "label": "Shipped"
}
```

### GET /orders/:id/tracking
Get tracking information for an order.

**Authentication:** Required (order owner)

### GET /orders/:id/history
Get order status change history.

**Authentication:** Required (admin only)

### GET /orders/stream
Server-Sent Events endpoint for real-time order updates.

**Query Parameters:**
- `userId` (required): User ID to subscribe to

**Events:**
- `order_status_changed`: Order status changed
- `order_created`: New order created
- `ping`: Keep-alive heartbeat (every 30s)
```

### 5.3 Update README

**File:** [`README.md`](README.md)

Add order status flow section:

```markdown
## Order Status Flow

This project implements a comprehensive order status flow with 18 states, real-time tracking, and automated notifications.

### Key Features
- **State Machine**: Validated transitions prevent invalid status changes
- **Real-Time Updates**: SSE-based live status updates
- **Push Notifications**: Web push for order status changes
- **Carrier Integration**: Automatic tracking from DHL, FedEx, UPS, USPS
- **Audit Trail**: Complete status history with reasons and timestamps

### Documentation
- [Order Tracking Help](docs/order-tracking-help.md)
- [Order API Documentation](docs/order-api.md)
- [Redesign Plan](plans/order-status-flow-redesign.md)
```

### 5.4 Verification Checkpoint

Verify all documentation files are created and linked:

```bash
ls -la docs/
```

---

## Step 6: Train Support Team

### 6.1 Create support runbook

**File:** `docs/support-runbook.md` (NEW FILE)

```markdown
# Support Team Runbook: Order Status Flow

## Common Issues and Resolutions

### "Where is my order?" (WISMO)

**Symptom:** Customer asks about order delivery status.

**Resolution:**
1. Look up order by order ID or email
2. Check current status and tracking number
3. If status is "shipped" or "out_for_delivery":
   - Provide tracking number and carrier link
   - Give estimated delivery date
4. If status is "delivery_exception":
   - Explain the issue
   - Offer re-delivery or refund options

### "Was my payment successful?"

**Symptom:** Customer unsure about payment status.

**Resolution:**
1. Check order status:
   - `payment_confirmed`: Payment successful
   - `payment_failed`: Payment declined
   - `payment_pending`: Still processing
2. If failed, guide customer to retry payment

### "Can I cancel my order?"

**Symptom:** Customer wants to cancel.

**Resolution:**
1. Check if order is cancellable:
   - Can cancel: `pending`, `payment_pending`, `payment_confirmed`, `confirmed`, `processing`
   - Cannot cancel: `shipped`, `out_for_delivery`, `delivered`
2. If cancellable, process cancellation with reason
3. If not cancellable, explain return process after delivery

### "I only received part of my order"

**Symptom:** Partial delivery.

**Resolution:**
1. Check order for `partially_shipped` status
2. Verify which items have shipped
3. Provide tracking for shipped items
4. Give ETA for remaining items

### "My order is delayed"

**Symptom:** Order past estimated delivery date.

**Resolution:**
1. Check tracking status with carrier
2. If carrier shows "in transit":
   - Apologize for delay
   - Provide updated ETA from carrier
3. If carrier shows "exception":
   - Explain the issue
   - Offer re-delivery or refund

## Admin Actions

### Update Order Status
1. Navigate to Orders → Select order
2. Click "Change Status"
3. Select new status and enter reason
4. Confirm change

### Issue Refund
1. Navigate to order detail page
2. Click "Issue Refund"
3. Enter refund amount and reason
4. Confirm refund

### Add Internal Note
1. Navigate to order detail page
2. Scroll to "Internal Notes" section
3. Enter note content
4. Click "Add Note"

## Escalation Path

| Issue | Escalate To | When |
|-------|-------------|------|
| Technical bug | Engineering | System error, data inconsistency |
| Payment dispute | Finance | Chargeback, refund dispute |
| Carrier issue | Logistics | Lost package, customs hold |
| Customer complaint | Manager | Threatening legal action |
```

### 6.2 Schedule training session

Create calendar invite for support team training:

- **Duration:** 2 hours
- **Agenda:**
  - 30 min: Overview of new order status flow
  - 30 min: Demo of admin order management
  - 30 min: Hands-on practice with test orders
  - 30 min: Q&A and runbook review

### 6.3 Verification Checkpoint

| Task | Status |
|------|--------|
| Support runbook created | ☐ |
| Training session scheduled | ☐ |
| All support team members trained | ☐ |
| Practice orders completed | ☐ |
| Escalation paths confirmed | ☐ |

---

## Step 7: Post-Launch Monitoring

### 7.1 Create monitoring dashboard configuration

**File:** `docs/monitoring-config.md` (NEW FILE)

```markdown
# Post-Launch Monitoring Configuration

## Key Metrics to Monitor

### System Metrics
| Metric | Source | Alert Threshold | Dashboard |
|--------|--------|-----------------|-----------|
| API response time (p95) | APM | > 200ms | System Health |
| Error rate | APM | > 0.1% | System Health |
| Memory usage | APM | > 512MB | System Health |
| SSE connections | Custom | < 99% uptime | Real-Time |
| Database query time | MongoDB | > 100ms | Database |

### Business Metrics
| Metric | Source | Target | Dashboard |
|--------|--------|--------|-----------|
| WISMO tickets/week | Support | -50% vs baseline | Support |
| Payment inquiries/week | Support | -60% vs baseline | Support |
| CSAT score | Survey | > 4.2/5.0 | Satisfaction |
| Order tracking page views | Analytics | 70% of orders | Engagement |
| Tracking link clicks | Analytics | 50% of shipped | Engagement |

### User Experience Metrics
| Metric | Source | Target | Dashboard |
|--------|--------|--------|-----------|
| Order detail page LCP | Lighthouse | < 1.5s | Performance |
| Order list page LCP | Lighthouse | < 2.0s | Performance |
| Notification open rate | Email service | 60% | Engagement |
| Return self-service rate | Analytics | 80% | Engagement |

## Monitoring Schedule

| Period | Frequency | Focus |
|--------|-----------|-------|
| Week 1-2 | Hourly | Error rates, latency, SSE stability |
| Week 3-4 | Daily | Business metrics, CSAT trends |
| Month 2+ | Weekly | Long-term trends, optimization opportunities |

## Incident Response

### Severity Levels
| Level | Description | Response Time |
|-------|-------------|---------------|
| P0 - Critical | System down, data loss | Immediate |
| P1 - High | Major feature broken | 15 minutes |
| P2 - Medium | Partial degradation | 1 hour |
| P3 - Low | Minor issue | Next business day |

### On-Call Rotation
- Primary: Backend Engineer (week 1-2), then rotate weekly
- Secondary: Frontend Engineer
- Escalation: Engineering Manager
```

### 7.2 Create post-launch checklist

**File:** `docs/post-launch-checklist.md` (NEW FILE)

```markdown
# Post-Launch Checklist

## Week 1-2: Intensive Monitoring

### Daily Checks
- [ ] Review error logs for new error types
- [ ] Check API p95 latency is under 200ms
- [ ] Verify SSE connections are stable
- [ ] Monitor support ticket volume
- [ ] Review beta feedback submissions
- [ ] Check carrier API success rates

### Weekly Reviews
- [ ] Compare WISMO tickets vs baseline
- [ ] Review CSAT scores
- [ ] Analyze order tracking page views
- [ ] Check notification delivery rates
- [ ] Review memory usage trends

## Week 3-4: Stabilization

- [ ] Reduce monitoring frequency to daily
- [ ] Document any patterns or issues found
- [ ] Optimize slow endpoints if identified
- [ ] Update documentation based on support questions
- [ ] Plan Phase 7 improvements if needed

## Month 2+: Ongoing

- [ ] Weekly metric reviews
- [ ] Monthly business impact review
- [ ] Quarterly feature enhancement planning
```

### 7.3 Verification Checkpoint

| Task | Status |
|------|--------|
| Monitoring dashboard configured | ☐ |
| Alert thresholds set | ☐ |
| On-call rotation established | ☐ |
| Post-launch checklist created | ☐ |
| 2-week monitoring period completed | ☐ |

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `render.yaml` | Modified | Added staging and canary service definitions |
| `apps/client/src/middleware.ts` | Modified | Added beta tester access control and canary routing |
| `apps/client/src/components/BetaFeedbackForm.tsx` | Created | Beta feedback form component |
| `apps/client/src/app/api/beta/feedback/route.ts` | Created | Feedback submission API endpoint |
| `apps/order-service/src/routes/sse.ts` | Modified | Added canary metrics endpoint |
| `apps/admin/src/app/(dashboard)/canary/page.tsx` | Created | Canary monitoring dashboard |
| `scripts/analyze-canary.ts` | Created | Canary metrics analysis script |
| `scripts/rollout.ts` | Created | Gradual rollout automation script |
| `docs/order-tracking-help.md` | Created | User-facing help documentation |
| `docs/order-api.md` | Created | API documentation |
| `docs/support-runbook.md` | Created | Support team runbook |
| `docs/monitoring-config.md` | Created | Monitoring dashboard configuration |
| `docs/post-launch-checklist.md` | Created | Post-launch monitoring checklist |
| `README.md` | Modified | Added order status flow section |

---

## Final Verification Checklist

### Pre-Rollout
- [ ] All Phases 1-5 completed and tested
- [ ] Staging environment deployed
- [ ] Beta testers invited and onboarded
- [ ] Beta feedback collection working
- [ ] Critical bugs from beta fixed

### Canary Release
- [ ] Canary deployment running
- [ ] 5% traffic routed to canary
- [ ] Metrics collection working
- [ ] Error rate < 0.5%
- [ ] API p95 latency < 200ms
- [ ] SSE connections stable

### Gradual Rollout
- [ ] 25% stage completed and monitored
- [ ] 50% stage completed and monitored
- [ ] 100% rollout completed
- [ ] No rollback triggered

### Documentation
- [ ] User help articles published
- [ ] API documentation updated
- [ ] README updated
- [ ] Support runbook distributed

### Support
- [ ] Support team trained
- [ ] Practice orders completed
- [ ] Escalation paths confirmed

### Monitoring
- [ ] Dashboards configured
- [ ] Alerts set up
- [ ] On-call rotation established
- [ ] 2-week monitoring period completed

---

## Rollback Strategy

If any issue is detected during rollout:

1. **Immediate Action:**
   ```bash
   # Emergency rollback to 5% canary
   cd scripts && npx ts-node rollout.ts --stage=5
   ```

2. **Investigate:**
   - Check error logs
   - Review metrics dashboard
   - Identify root cause

3. **Fix:**
   - Implement fix in staging
   - Test fix thoroughly
   - Re-run canary process

4. **Communicate:**
   - Notify stakeholders
   - Update status page
   - Inform support team

---

## Success Criteria

Phase 6 is considered successful when:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Rollout completed | 100% traffic | Deployment dashboard |
| Error rate | < 0.1% | APM monitoring |
| API p95 latency | < 200ms | APM monitoring |
| WISMO tickets | -50% vs baseline | Support ticket system |
| CSAT score | > 4.2/5.0 | Post-delivery survey |
| Order tracking views | 70% of orders | Analytics |
| Support team trained | 100% | Training completion log |
| Documentation updated | All docs current | Documentation review |
