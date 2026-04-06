# Phase 5 Implementation Guide: Real-Time & Polish

**Goal:** Add real-time updates via Server-Sent Events (SSE), push notification support, carrier tracking integration, estimated delivery calculation, performance optimization, and load testing.

**Prerequisites:** Phases 1–4 must be fully completed and integrated, including:
- Extended OrderSchema with all new fields (Phase 1)
- State machine service with transition validation (Phase 1)
- Notification service and API endpoints (Phase 2)
- Client-side reusable components and order detail page (Phase 3)
- Admin order management with bulk actions and internal notes (Phase 4)
- All API endpoints operational (`PATCH /orders/:id/status`, `GET /orders/:id`, `GET /orders/:id/tracking`, `GET /orders/:id/history`)

---

## Step 1: Implement Server-Sent Events (SSE) Endpoint

**File:** `apps/order-service/src/routes/sse.ts` (NEW FILE)

### 1.1 Create the SSE route module

This module implements an SSE endpoint that streams order status updates to connected clients in real-time.

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Order } from "@repo/order-db";
import { OrderStatusType } from "@repo/types";

/**
 * Event stream manager for SSE connections.
 */
interface EventStream {
  id: string;
  userId: string;
  response: FastifyReply;
  lastEventId: number;
}

/**
 * Registry of active SSE connections.
 */
const connections: EventStream[] = [];

/**
 * Broadcasts an event to all connected clients for a specific user.
 *
 * @param userId - User ID to broadcast to
 * @param event - Event type
 * @param data - Event data payload
 */
export function broadcastToUser(userId: string, event: string, data: any): void {
  const userConnections = connections.filter((c) => c.userId === userId);

  for (const conn of userConnections) {
    try {
      conn.lastEventId++;
      const sseData = `id: ${conn.lastEventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      conn.response.raw.write(sseData);
    } catch (error) {
      console.error(`Failed to send SSE event to connection ${conn.id}:`, error);
      // Remove failed connection
      const index = connections.indexOf(conn);
      if (index > -1) {
        connections.splice(index, 1);
      }
    }
  }
}

/**
 * Broadcasts an event to all connected clients (admin use case).
 *
 * @param event - Event type
 * @param data - Event data payload
 */
export function broadcastAll(event: string, data: any): void {
  for (const conn of connections) {
    try {
      conn.lastEventId++;
      const sseData = `id: ${conn.lastEventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      conn.response.raw.write(sseData);
    } catch (error) {
      console.error(`Failed to send SSE event to connection ${conn.id}:`, error);
      const index = connections.indexOf(conn);
      if (index > -1) {
        connections.splice(index, 1);
      }
    }
  }
}

/**
 * SSE route plugin for order-service.
 */
export const sseRoute = async (fastify: FastifyInstance) => {
  /**
   * SSE endpoint for real-time order status updates.
   *
   * Clients connect to this endpoint and receive a stream of events:
   * - order_status_changed: When an order's status changes
   * - order_created: When a new order is created for the user
   * - ping: Keep-alive heartbeat every 30 seconds
   *
   * Query parameters:
   * - userId: Required. The user ID to subscribe to events for.
   * - lastEventId: Optional. For reconnection support.
   */
  fastify.get(
    "/orders/stream",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            userId: { type: "string" },
            lastEventId: { type: "string" },
          },
          required: ["userId"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId, lastEventId } = request.query as {
        userId: string;
        lastEventId?: string;
      };

      // Set SSE headers
      reply
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .header("X-Accel-Buffering", "no"); // Disable nginx buffering

      // Generate unique connection ID
      const connectionId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Initialize event counter
      let eventId = lastEventId ? parseInt(lastEventId, 10) : 0;

      // Send initial connection confirmation
      reply.raw.write(
        `id: ${eventId}\nevent: connected\ndata: ${JSON.stringify({ connectionId, message: "SSE connection established" })}\n\n`,
      );

      // Register connection
      const connection: EventStream = {
        id: connectionId,
        userId,
        response: reply,
        lastEventId: eventId,
      };
      connections.push(connection);

      // Handle client disconnect
      request.raw.on("close", () => {
        const index = connections.indexOf(connection);
        if (index > -1) {
          connections.splice(index, 1);
        }
        console.log(`SSE connection closed: ${connectionId}`);
      });

      // Send periodic ping to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          reply.raw.write(`id: ${++eventId}\nevent: ping\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        } catch (error) {
          clearInterval(pingInterval);
        }
      }, 30000); // Every 30 seconds

      // Clean up on disconnect
      request.raw.on("close", () => {
        clearInterval(pingInterval);
      });

      // Keep the connection open indefinitely
      return reply;
    },
  );

  /**
   * Get active connection count (for monitoring).
   */
  fastify.get("/orders/stream/stats", async (request, reply) => {
    return reply.send({
      activeConnections: connections.length,
      uniqueUsers: new Set(connections.map((c) => c.userId)).size,
    });
  });
};

/**
 * Helper to notify when an order status changes.
 * Call this from the status update endpoint after successful update.
 */
export async function notifyOrderStatusChange(
  userId: string,
  orderId: string,
  previousStatus: OrderStatusType,
  newStatus: OrderStatusType,
  orderData?: any,
): Promise<void> {
  broadcastToUser(userId, "order_status_changed", {
    orderId,
    previousStatus,
    newStatus,
    timestamp: Date.now(),
    order: orderData,
  });
}

/**
 * Helper to notify when a new order is created.
 */
export async function notifyOrderCreated(
  userId: string,
  orderData: any,
): Promise<void> {
  broadcastToUser(userId, "order_created", {
    orderId: orderData._id,
    timestamp: Date.now(),
    order: orderData,
  });
}
```

### 1.2 Register SSE route in order-service

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

Add the SSE route registration:

```typescript
import { sseRoute } from "./routes/sse";

// ... existing code ...

fastify.register(sseRoute);
```

### 1.3 Integrate SSE notifications into status update

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

Add SSE notification after successful status change in the PATCH endpoint:

```typescript
import { notifyOrderStatusChange } from "./sse";

// ... in the PATCH /orders/:id/status handler, after successful update ...

// Send SSE notification
await notifyOrderStatusChange(
  updatedOrder.userId,
  updatedOrder._id.toString(),
  previousStatus,
  newStatus,
  updatedOrder.toObject(),
);
```

### 1.4 Required Dependencies

No new dependencies. SSE uses native Node.js HTTP streaming.

### 1.5 Verification Checkpoint

```bash
cd apps/order-service && pnpm tsc --noEmit
```

### 1.6 Test SSE Endpoint

```bash
# Start the order service
cd apps/order-service && pnpm dev

# Connect to SSE endpoint (in another terminal)
curl -N "http://localhost:8001/orders/stream?userId=test-user-123"
```

Expected output: Initial `connected` event, followed by `ping` events every 30 seconds.

### 1.7 Rollback Procedure

If SSE causes memory leaks or connection issues:
1. Remove `fastify.register(sseRoute)` from `index.ts`
2. Remove SSE notification calls from route handlers
3. Restart order-service

---

## Step 2: Add SSE Client Integration

**File:** `apps/client/src/hooks/useSSE.ts` (NEW FILE)

### 2.1 Create the SSE client hook

This hook manages SSE connection with automatic reconnection and fallback to polling.

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { OrderType, OrderStatusType } from "@repo/types";

/**
 * SSE event types.
 */
type SSEEventType = "order_status_changed" | "order_created" | "ping" | "connected";

/**
 * SSE event structure.
 */
interface SSEEvent {
  id: string;
  event: SSEEventType;
  data: any;
}

/**
 * Hook options.
 */
interface UseSSEOptions {
  /** User ID to subscribe to */
  userId: string;
  /** Whether to enable SSE */
  enabled?: boolean;
  /** Callback when order status changes */
  onOrderStatusChange?: (data: any) => void;
  /** Callback when new order is created */
  onOrderCreated?: (data: any) => void;
  /** Polling interval for fallback (ms) */
  pollingInterval?: number;
}

/**
 * Hook return value.
 */
interface UseSSEReturn {
  /** Whether SSE connection is active */
  isConnected: boolean;
  /** Whether using fallback polling */
  isPolling: boolean;
  /** Last event received */
  lastEvent: SSEEvent | null;
  /** Connection error */
  error: Error | null;
  /** Manual reconnect function */
  reconnect: () => void;
}

/**
 * Server-Sent Events client hook.
 *
 * Manages SSE connection with automatic reconnection and fallback to polling.
 *
 * @example
 * const { isConnected, isPolling } = useSSE({
 *   userId: user.id,
 *   onOrderStatusChange: (data) => {
 *     console.log(`Order ${data.orderId} changed: ${data.newStatus}`);
 *     // Update UI or show notification
 *   },
 * });
 */
export function useSSE({
  userId,
  enabled = true,
  onOrderStatusChange,
  onOrderCreated,
  pollingInterval = 30000,
}: UseSSEOptions): UseSSEReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 5;

  const ORDER_SERVICE_URL =
    process.env.NEXT_PUBLIC_ORDER_SERVICE_URL || "http://localhost:8001";

  const connect = useCallback(() => {
    if (!enabled || !userId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const url = `${ORDER_SERVICE_URL}/orders/stream?userId=${userId}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setIsPolling(false);
        setError(null);
        retryCountRef.current = 0;
        console.log("SSE connection established");
      };

      eventSource.addEventListener("order_status_changed", (e) => {
        const data = JSON.parse(e.data);
        setLastEvent({ id: e.lastEventId, event: "order_status_changed", data });
        onOrderStatusChange?.(data);
      });

      eventSource.addEventListener("order_created", (e) => {
        const data = JSON.parse(e.data);
        setLastEvent({ id: e.lastEventId, event: "order_created", data });
        onOrderCreated?.(data);
      });

      eventSource.addEventListener("ping", (e) => {
        // Heartbeat received, connection is alive
        setLastEvent({ id: e.lastEventId, event: "ping", data: JSON.parse(e.data) });
      });

      eventSource.onerror = (err) => {
        console.error("SSE connection error:", err);
        setIsConnected(false);
        eventSource.close();

        // Attempt reconnection with exponential backoff
        if (retryCountRef.current < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryCountRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Reconnecting SSE (attempt ${retryCountRef.current})...`);
            connect();
          }, delay);
        } else {
          // Fall back to polling
          console.warn("SSE reconnection failed, falling back to polling");
          setIsPolling(true);
          setError(new Error("SSE connection failed, using polling fallback"));
          startPolling();
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setIsConnected(false);
    }
  }, [userId, enabled, onOrderStatusChange, onOrderCreated, ORDER_SERVICE_URL]);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(() => {
      // Polling logic would go here - trigger data refetch
      console.log("Polling for updates...");
    }, pollingInterval);
  }, [pollingInterval]);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    setIsPolling(false);
    setError(null);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    connect();
  }, [connect]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [enabled, connect]);

  return {
    isConnected,
    isPolling,
    lastEvent,
    error,
    reconnect,
  };
}

export default useSSE;
```

### 2.2 Update order detail page to use SSE

**File:** `apps/client/src/app/orders/[id]/client.tsx`

Add SSE integration to the client component:

```tsx
import { useSSE } from "@/hooks/useSSE";
import { useUser } from "@clerk/nextjs";

// ... inside the component ...

const { user } = useUser();

const { isConnected, isPolling, error: sseError } = useSSE({
  userId: user?.id || "",
  enabled: !!user?.id && !["delivered", "cancelled", "refunded"].includes(
    initialOrder.status as OrderStatusType,
  ),
  onOrderStatusChange: (data) => {
    if (data.orderId === initialOrder._id) {
      // Status changed for this order, show notification
      setShowStatusToast(true);
      setPreviousStatus(data.previousStatus);
      setCurrentStatus(data.newStatus);
      setTimeout(() => setShowStatusToast(false), 5000);
    }
  },
});
```

### 2.3 Add connection status indicator

Add to the order detail page header:

```tsx
{/* SSE connection status */}
<div className="flex items-center gap-2 text-xs">
  {isConnected && (
    <span className="text-green-600 flex items-center gap-1">
      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      Live updates
    </span>
  )}
  {isPolling && (
    <span className="text-yellow-600 flex items-center gap-1">
      <span className="w-2 h-2 bg-yellow-500 rounded-full" />
      Polling (30s)
    </span>
  )}
  {sseError && (
    <button
      onClick={reconnect}
      className="text-red-600 hover:underline"
    >
      Reconnect
    </button>
  )}
</div>
```

### 2.4 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

### 2.5 Rollback Procedure

If SSE client causes issues:
1. Remove `useSSE` hook usage from components
2. Revert to polling-only approach from Phase 3
3. Remove SSE hook file

---

## Step 3: Add Push Notification Support

**File:** `apps/client/src/utils/pushNotifications.ts` (NEW FILE)

### 3.1 Create push notification utility

```typescript
/**
 * Push notification service configuration.
 */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

/**
 * Request push notification permission and subscribe user.
 *
 * @returns PushSubscription or null if not available
 */
export async function subscribeToPushNotifications(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications not supported");
    return null;
  }

  try {
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Notification permission denied");
      return null;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    // Subscribe to push notifications
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Send subscription to server
    await sendSubscriptionToServer(subscription);

    console.log("Push notification subscription created");
    return subscription;
  } catch (error) {
    console.error("Failed to subscribe to push notifications:", error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
      await sendUnsubscribeToServer(subscription);
      console.log("Unsubscribed from push notifications");
    }
  } catch (error) {
    console.error("Failed to unsubscribe:", error);
  }
}

/**
 * Send subscription to server for storage.
 */
async function sendSubscriptionToServer(
  subscription: PushSubscription,
): Promise<void> {
  try {
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.toJSON().keys?.p256dh,
          auth: subscription.toJSON().keys?.auth,
        },
      }),
    });
  } catch (error) {
    console.error("Failed to send subscription to server:", error);
  }
}

/**
 * Send unsubscribe to server.
 */
async function sendUnsubscribeToServer(
  subscription: PushSubscription,
): Promise<void> {
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
      }),
    });
  } catch (error) {
    console.error("Failed to send unsubscribe to server:", error);
  }
}

/**
 * Convert VAPID key from base64 to Uint8Array.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Check if push notifications are supported and enabled.
 */
export function isPushNotificationSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
```

### 3.2 Create service worker

**File:** `apps/client/public/sw.js` (NEW FILE)

```javascript
/**
 * Service Worker for push notifications.
 *
 * Handles incoming push messages and displays notifications.
 */

self.addEventListener("push", function (event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: "Order Update", body: event.data.text() };
  }

  const title = data.title || "Order Update";
  const options = {
    body: data.body || "Your order status has changed",
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: {
      url: data.url || "/orders",
      orderId: data.orderId,
    },
    actions: data.actions || [
      { action: "view", title: "View Order" },
      { action: "close", title: "Dismiss" },
    ],
    tag: data.orderId || "order-update",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  if (event.action === "view" || !event.action) {
    const urlToOpen = event.notification.data?.url || "/orders";
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
        // Try to focus existing window
        for (const client of clientList) {
          if (client.url.includes(urlToOpen) && "focus" in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
    );
  }
});

self.addEventListener("pushsubscriptionchange", function (event) {
  // Handle subscription expiration
  console.log("Push subscription changed");
});
```

### 3.3 Create push subscription API routes

**File:** `apps/client/src/app/api/push/subscribe/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Store subscription in database
    // TODO: Implement subscription storage
    console.log("Push subscription received:", body.endpoint);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process subscription" },
      { status: 500 },
    );
  }
}
```

**File:** `apps/client/src/app/api/push/unsubscribe/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Remove subscription from database
    console.log("Push unsubscribe received:", body.endpoint);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process unsubscribe" },
      { status: 500 },
    );
  }
}
```

### 3.4 Add push notification prompt to layout

**File:** `apps/client/src/app/layout.tsx`

Add client component for push notification permission:

```tsx
"use client";

import { useEffect } from "react";
import { subscribeToPushNotifications, isPushNotificationSupported } from "@/utils/pushNotifications";

function PushNotificationInitializer() {
  useEffect(() => {
    if (isPushNotificationSupported()) {
      // Prompt user after a delay
      const timer = setTimeout(() => {
        subscribeToPushNotifications();
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, []);

  return null;
}

// Add to the layout component body
<PushNotificationInitializer />
```

### 3.5 Required Dependencies

No new dependencies. Uses native Web Push API.

### 3.6 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

### 3.7 Rollback Procedure

If push notifications cause issues:
1. Remove `PushNotificationInitializer` from layout
2. Remove service worker file `public/sw.js`
3. Remove push notification utility files

---

## Step 4: Build Carrier Tracking Integration

**File:** `apps/order-service/src/utils/carrierTracking.ts` (NEW FILE)

### 4.1 Create carrier tracking service

This module integrates with carrier APIs (DHL, FedEx, UPS) to fetch real-time tracking updates.

```typescript
/**
 * Carrier tracking integration service.
 *
 * Supports multiple carriers with unified tracking interface.
 */

/**
 * Tracking event from carrier.
 */
export interface TrackingEvent {
  timestamp: Date;
  status: string;
  location: string;
  description: string;
}

/**
 * Tracking result.
 */
export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  status: "in_transit" | "out_for_delivery" | "delivered" | "exception" | "unknown";
  estimatedDeliveryDate?: Date;
  actualDeliveryDate?: Date;
  events: TrackingEvent[];
}

/**
 * Carrier API configuration.
 */
interface CarrierConfig {
  name: string;
  trackingUrl: string;
  apiKey?: string;
  accountId?: string;
}

/**
 * Carrier configurations from environment variables.
 */
const CARRIER_CONFIG: Record<string, CarrierConfig> = {
  dhl: {
    name: "DHL",
    trackingUrl: "https://api-eu.dhl.com/track/shipments",
    apiKey: process.env.DHL_API_KEY,
  },
  fedex: {
    name: "FedEx",
    trackingUrl: "https://apis.fedex.com/track/v1/track",
    apiKey: process.env.FEDEX_API_KEY,
    accountId: process.env.FEDEX_ACCOUNT_NUMBER,
  },
  ups: {
    name: "UPS",
    trackingUrl: "https://onlinetools.ups.com/api/track/v1/details",
    apiKey: process.env.UPS_API_KEY,
  },
  usps: {
    name: "USPS",
    trackingUrl: "https://secure.shippingapis.com/ShippingAPI.dll",
    apiKey: process.env.USPS_API_KEY,
  },
};

/**
 * Map carrier status to our internal status.
 */
const CARRIER_STATUS_MAP: Record<string, TrackingResult["status"]> = {
  // DHL
  "pre-transit": "in_transit",
  "in transit": "in_transit",
  "out for delivery": "out_for_delivery",
  delivered: "delivered",
  exception: "exception",
  // FedEx
  "In transit": "in_transit",
  "On FedEx vehicle for delivery": "out_for_delivery",
  "Delivered": "delivered",
  "Delivery exception": "exception",
  // UPS
  "In Transit": "in_transit",
  "Out For Delivery": "out_for_delivery",
  "Delivered": "delivered",
  "Exception": "exception",
};

/**
 * Fetch tracking info from carrier API.
 *
 * @param trackingNumber - Carrier tracking number
 * @param carrier - Carrier name (dhl, fedex, ups, usps)
 * @returns Tracking result or null if not found
 */
export async function fetchCarrierTracking(
  trackingNumber: string,
  carrier: string,
): Promise<TrackingResult | null> {
  const config = CARRIER_CONFIG[carrier.toLowerCase()];
  if (!config) {
    console.warn(`Unknown carrier: ${carrier}`);
    return null;
  }

  try {
    switch (carrier.toLowerCase()) {
      case "dhl":
        return await fetchDHLTracking(trackingNumber, config);
      case "fedex":
        return await fetchFedExTracking(trackingNumber, config);
      case "ups":
        return await fetchUPSTracking(trackingNumber, config);
      case "usps":
        return await fetchUSPSTracking(trackingNumber, config);
      default:
        return null;
    }
  } catch (error) {
    console.error(`Failed to fetch tracking from ${carrier}:`, error);
    return null;
  }
}

/**
 * DHL tracking integration.
 */
async function fetchDHLTracking(
  trackingNumber: string,
  config: CarrierConfig,
): Promise<TrackingResult | null> {
  if (!config.apiKey) {
    console.warn("DHL API key not configured");
    return null;
  }

  const response = await fetch(
    `${config.trackingUrl}?trackingNumber=${trackingNumber}`,
    {
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Accept": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`DHL API error: ${response.status}`);
  }

  const data = await response.json();
  return parseDHLResponse(trackingNumber, data);
}

/**
 * FedEx tracking integration.
 */
async function fetchFedExTracking(
  trackingNumber: string,
  config: CarrierConfig,
): Promise<TrackingResult | null> {
  if (!config.apiKey) {
    console.warn("FedEx API key not configured");
    return null;
  }

  const response = await fetch(config.trackingUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trackingNumberInfo: { trackingNumber },
    }),
  });

  if (!response.ok) {
    throw new Error(`FedEx API error: ${response.status}`);
  }

  const data = await response.json();
  return parseFedExResponse(trackingNumber, data);
}

/**
 * UPS tracking integration.
 */
async function fetchUPSTracking(
  trackingNumber: string,
  config: CarrierConfig,
): Promise<TrackingResult | null> {
  if (!config.apiKey) {
    console.warn("UPS API key not configured");
    return null;
  }

  const response = await fetch(
    `${config.trackingUrl}/${trackingNumber}`,
    {
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Accept": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`UPS API error: ${response.status}`);
  }

  const data = await response.json();
  return parseUPSResponse(trackingNumber, data);
}

/**
 * USPS tracking integration.
 */
async function fetchUSPSTracking(
  trackingNumber: string,
  config: CarrierConfig,
): Promise<TrackingResult | null> {
  if (!config.apiKey) {
    console.warn("USPS API key not configured");
    return null;
  }

  const response = await fetch(
    `${config.trackingUrl}?API=TrackV2.0&XML=<TrackRequest USERID="${config.apiKey}"><TrackID ID="${trackingNumber}"></TrackID></TrackRequest>`,
  );

  if (!response.ok) {
    throw new Error(`USPS API error: ${response.status}`);
  }

  const text = await response.text();
  return parseUSPSResponse(trackingNumber, text);
}

/**
 * Parse DHL API response.
 */
function parseDHLResponse(trackingNumber: string, data: any): TrackingResult {
  const shipment = data.shipments?.[0];
  if (!shipment) {
    return {
      trackingNumber,
      carrier: "DHL",
      status: "unknown",
      events: [],
    };
  }

  const status = CARRIER_STATUS_MAP[shipment.status] || "unknown";
  const events = shipment.events?.map((e: any) => ({
    timestamp: new Date(e.timestamp),
    status: e.status,
    location: e.location,
    description: e.description,
  })) || [];

  return {
    trackingNumber,
    carrier: "DHL",
    status,
    estimatedDeliveryDate: shipment.deliveryDate ? new Date(shipment.deliveryDate) : undefined,
    actualDeliveryDate: status === "delivered" ? new Date() : undefined,
    events,
  };
}

/**
 * Parse FedEx API response.
 */
function parseFedExResponse(trackingNumber: string, data: any): TrackingResult {
  const trackDetail = data.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!trackDetail) {
    return {
      trackingNumber,
      carrier: "FedEx",
      status: "unknown",
      events: [],
    };
  }

  const status = CARRIER_STATUS_MAP[trackDetail.latestStatusDetail?.description] || "unknown";
  const events = trackDetail.events?.map((e: any) => ({
    timestamp: new Date(e.date),
    status: e.statusDescription,
    location: e.city + ", " + e.stateOrProvinceCode,
    description: e.eventDescription,
  })) || [];

  return {
    trackingNumber,
    carrier: "FedEx",
    status,
    estimatedDeliveryDate: trackDetail.estimatedDeliveryDate ? new Date(trackDetail.estimatedDeliveryDate) : undefined,
    actualDeliveryDate: status === "delivered" ? new Date() : undefined,
    events,
  };
}

/**
 * Parse UPS API response.
 */
function parseUPSResponse(trackingNumber: string, data: any): TrackingResult {
  const shipment = data.trackResponse?.shipments?.[0];
  if (!shipment) {
    return {
      trackingNumber,
      carrier: "UPS",
      status: "unknown",
      events: [],
    };
  }

  const status = CARRIER_STATUS_MAP[shipment.package?.[0]?.deliveryDate?.Type] || "unknown";
  const events = shipment.package?.[0]?.activity?.map((a: any) => ({
    timestamp: new Date(a.date + " " + a.time),
    status: a.status?.description,
    location: a.location?.address?.city,
    description: a.status?.description,
  })) || [];

  return {
    trackingNumber,
    carrier: "UPS",
    status,
    estimatedDeliveryDate: shipment.scheduledDeliveryDate ? new Date(shipment.scheduledDeliveryDate) : undefined,
    actualDeliveryDate: status === "delivered" ? new Date() : undefined,
    events,
  };
}

/**
 * Parse USPS API response (XML).
 */
function parseUSPSResponse(trackingNumber: string, xml: string): TrackingResult {
  // Simple XML parsing - use a proper XML parser in production
  const statusMatch = xml.match(/<Status>(.*?)<\/Status>/);
  const status = statusMatch ? CARRIER_STATUS_MAP[statusMatch[1]] || "unknown" : "unknown";

  return {
    trackingNumber,
    carrier: "USPS",
    status,
    events: [],
  };
}

/**
 * Poll all orders with tracking numbers for updates.
 *
 * Call this from a scheduled job (e.g., every 15 minutes).
 */
export async function pollTrackingUpdates(): Promise<number> {
  const { Order } = await import("@repo/order-db");
  const { recordStatusChange } = await import("./auditLogger");
  const { OrderStatusType } = await import("@repo/types");

  // Find orders with tracking numbers that are not delivered
  const orders = await Order.find({
    "shipments.trackingNumber": { $exists: true, $ne: null },
    status: { $nin: ["delivered", "cancelled", "refunded"] },
  });

  let updatedCount = 0;

  for (const order of orders) {
    for (const shipment of order.shipments || []) {
      if (!shipment.trackingNumber || !shipment.carrier) continue;

      const trackingResult = await fetchCarrierTracking(
        shipment.trackingNumber,
        shipment.carrier,
      );

      if (!trackingResult) continue;

      // Update shipment status
      shipment.status = trackingResult.status;

      if (trackingResult.estimatedDeliveryDate) {
        order.estimatedDeliveryDate = trackingResult.estimatedDeliveryDate;
      }

      if (trackingResult.status === "delivered") {
        order.actualDeliveryDate = trackingResult.actualDeliveryDate;
      }

      // Map to order status and update if changed
      const statusMapping: Record<string, OrderStatusType> = {
        in_transit: "shipped",
        out_for_delivery: "out_for_delivery",
        delivered: "delivered",
        exception: "delivery_exception",
      };

      const newOrderStatus = statusMapping[trackingResult.status];
      const currentStatus = order.status as OrderStatusType;

      if (newOrderStatus && newOrderStatus !== currentStatus) {
        try {
          const { validateTransition } = await import("./stateMachine");
          validateTransition(currentStatus, newOrderStatus);

          const previousStatus = currentStatus;
          order.status = newOrderStatus;

          order.statusHistory.push({
            from: previousStatus,
            to: newOrderStatus,
            reason: `Carrier update: ${trackingResult.status}`,
            changedBy: "system",
            changedAt: new Date(),
          });

          await order.save();

          // Dispatch notifications
          const { dispatchNotifications } = await import("./notifications");
          dispatchNotifications(order.toObject(), previousStatus, "system").catch(
            (err) => console.error("Notification dispatch failed:", err),
          );

          updatedCount++;
        } catch (error) {
          console.log(
            `Skipping invalid transition: ${currentStatus} -> ${newOrderStatus}`,
          );
        }
      } else {
        await order.save();
      }
    }
  }

  return updatedCount;
}
```

### 4.2 Add scheduled polling job

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

Add carrier tracking poll to startup:

```typescript
import { pollTrackingUpdates } from "./utils/carrierTracking";

// ... in the start function, after auto-cancel job setup ...

// Start carrier tracking poll job (every 15 minutes)
const TRACKING_POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

setInterval(async () => {
  try {
    const updated = await pollTrackingUpdates();
    if (updated > 0) {
      console.log(`Carrier tracking poll: ${updated} orders updated`);
    }
  } catch (error) {
    console.error("Carrier tracking poll failed:", error);
  }
}, TRACKING_POLL_INTERVAL);

console.log(`Carrier tracking poll started (every ${TRACKING_POLL_INTERVAL / 1000 / 60} minutes)`);
```

### 4.3 Add carrier API keys to environment

Add to `.env` for order-service:

```bash
# Carrier API Keys
DHL_API_KEY=your_dhl_api_key
FEDEX_API_KEY=your_fedex_api_key
FEDEX_ACCOUNT_NUMBER=your_fedex_account
UPS_API_KEY=your_ups_api_key
USPS_API_KEY=your_usps_api_key
```

### 4.4 Verification Checkpoint

```bash
cd apps/order-service && pnpm tsc --noEmit
```

### 4.5 Rollback Procedure

If carrier integration causes issues:
1. Remove `pollTrackingUpdates` from `index.ts`
2. Remove carrier API keys from environment
3. Orders will continue to work with manual tracking webhook

---

## Step 5: Add Estimated Delivery Calculation

**File:** `apps/order-service/src/utils/estimatedDelivery.ts` (NEW FILE)

### 5.1 Create ETA calculation utility

```typescript
/**
 * Estimated delivery date calculation.
 *
 * Calculates ETA based on carrier, shipping method, and destination.
 */

/**
 * Carrier delivery time estimates (business days).
 */
const CARRIER_DELIVERY_DAYS: Record<string, { min: number; max: number }> = {
  dhl: { min: 3, max: 7 },
  fedex: { min: 2, max: 5 },
  ups: { min: 3, max: 7 },
  usps: { min: 5, max: 10 },
  standard: { min: 7, max: 14 },
  express: { min: 1, max: 3 },
};

/**
 * Calculate estimated delivery date.
 *
 * @param orderDate - Order creation date
 * @param carrier - Shipping carrier
 * @param shippingMethod - Shipping method (standard, express)
 * @param destination - Destination country code
 * @returns Object with min and max estimated delivery dates
 */
export function calculateEstimatedDelivery(
  orderDate: Date,
  carrier?: string,
  shippingMethod?: string,
  destination?: string,
): { min: Date; max: Date } {
  // Determine delivery time estimate
  let deliveryDays = CARRIER_DELIVERY_DAYS.standard;

  if (carrier && CARRIER_DELIVERY_DAYS[carrier.toLowerCase()]) {
    deliveryDays = CARRIER_DELIVERY_DAYS[carrier.toLowerCase()];
  }

  if (shippingMethod === "express") {
    deliveryDays = CARRIER_DELIVERY_DAYS.express;
  }

  // Add buffer for international shipping
  const isInternational = destination && destination !== "TZ";
  const internationalBuffer = isInternational ? 3 : 0;

  // Calculate dates (business days only)
  const minDate = addBusinessDays(orderDate, deliveryDays.min + internationalBuffer);
  const maxDate = addBusinessDays(orderDate, deliveryDays.max + internationalBuffer);

  return { min: minDate, max: maxDate };
}

/**
 * Add business days to a date (excluding weekends).
 */
function addBusinessDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  let addedDays = 0;

  while (addedDays < days) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }

  return result;
}

/**
 * Format ETA for display.
 */
export function formatETA(min: Date, max: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };

  if (min.toDateString() === max.toDateString()) {
    return `Estimated delivery: ${min.toLocaleDateString("en-US", options)}`;
  }

  return `Estimated delivery: ${min.toLocaleDateString("en-US", options)} - ${max.toLocaleDateString("en-US", options)}`;
}

/**
 * Update order with estimated delivery date.
 * Call this when order is created or when carrier info is added.
 */
export async function updateOrderEstimatedDelivery(
  orderId: string,
  carrier?: string,
  shippingMethod?: string,
  destination?: string,
): Promise<void> {
  const { Order } = await import("@repo/order-db");

  const order = await Order.findById(orderId);
  if (!order) return;

  const orderDate = order.createdAt || new Date();
  const eta = calculateEstimatedDelivery(orderDate, carrier, shippingMethod, destination);

  // Store the max estimate as the official estimated delivery date
  order.estimatedDeliveryDate = eta.max;

  await order.save();
}
```

### 5.2 Integrate into order creation

**File:** [`apps/order-service/src/utils/order.ts`](apps/order-service/src/utils/order.ts)

Add ETA calculation after order creation:

```typescript
import { updateOrderEstimatedDelivery } from "./estimatedDelivery";

// ... in createOrder, after saving ...

// Calculate estimated delivery
await updateOrderEstimatedDelivery(
  savedOrder._id.toString(),
  undefined, // carrier not known yet
  undefined, // shipping method
  savedOrder.shippingAddress?.country,
);
```

### 5.3 Verification Checkpoint

```bash
cd apps/order-service && pnpm tsc --noEmit
```

### 5.4 Rollback Procedure

If ETA calculation causes issues:
1. Remove `updateOrderEstimatedDelivery` call from order creation
2. Orders will simply have null `estimatedDeliveryDate`

---

## Step 6: Performance Optimization

### 6.1 Add database indexes

**File:** [`packages/order-db/src/order-model.ts`](packages/order-db/src/order-model.ts)

Add indexes for frequently queried fields:

```typescript
// Add to schema options
{
  timestamps: true,
  // Add indexes
  index: {
    userId: 1,
    status: 1,
    createdAt: -1,
  },
}
```

Add compound index for order queries:

```typescript
// After schema definition
OrderSchema.index({ userId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ "shipments.trackingNumber": 1 });
OrderSchema.index({ paymentIntentId: 1 }, { sparse: true });
```

### 6.2 Add response caching

**File:** `apps/order-service/src/utils/cache.ts` (NEW FILE)

```typescript
/**
 * Simple in-memory cache for API responses.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

/**
 * Get cached data.
 */
export function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Set cached data.
 */
export function setInCache<T>(
  key: string,
  data: T,
  ttlMs: number = 60000, // 1 minute default
): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Invalidate cache entry.
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all cache entries for a user.
 */
export function invalidateUserCache(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`user:${userId}`)) {
      cache.delete(key);
    }
  }
}
```

### 6.3 Add compression to Fastify

```bash
cd apps/order-service && pnpm add @fastify/compress
```

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

```typescript
import FastifyCompress from "@fastify/compress";

fastify.register(FastifyCompress, {
  global: true,
  encodings: ["gzip", "deflate"],
});
```

### 6.4 Add response time monitoring

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

```typescript
// Add response time logging
fastify.addHook("onResponse", (request, reply, done) => {
  const responseTime = reply.elapsedTime;
  if (responseTime > 200) {
    console.warn(
      `Slow response: ${request.method} ${request.url} took ${responseTime}ms`,
    );
  }
  done();
});
```

### 6.5 Verification Checkpoint

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 7: Load Testing

### 7.1 Create k6 load test script

**File:** `apps/order-service/tests/load/orders.load.js` (NEW FILE)

```javascript
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");

// Test configuration
export const options = {
  stages: [
    { duration: "30s", target: 100 },   // Ramp up to 100 users
    { duration: "1m", target: 100 },    // Stay at 100 users
    { duration: "30s", target: 500 },   // Ramp up to 500 users
    { duration: "1m", target: 500 },    // Stay at 500 users
    { duration: "30s", target: 1000 },  // Ramp up to 1000 users
    { duration: "2m", target: 1000 },   // Stay at 1000 users
    { duration: "30s", target: 0 },     // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ["p(95)<200"], // 95% of requests should be below 200ms
    http_req_failed: ["rate<0.01"],   // Error rate should be less than 1%
    errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.ORDER_SERVICE_URL || "http://localhost:8001";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "test-token";

export default function () {
  // Test GET /orders
  const ordersRes = http.get(`${BASE_URL}/orders?limit=50`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });

  check(ordersRes, {
    "GET /orders status is 200": (r) => r.status === 200,
    "GET /orders response time < 200ms": (r) => r.timings.duration < 200,
  });

  if (ordersRes.status !== 200) {
    errorRate.add(1);
  }

  // Test GET /dashboard-stats
  const statsRes = http.get(`${BASE_URL}/dashboard-stats`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });

  check(statsRes, {
    "GET /dashboard-stats status is 200": (r) => r.status === 200,
  });

  sleep(1);
}
```

### 7.2 Run load tests

```bash
# Install k6 (macOS)
brew install k6

# Run load test
ORDER_SERVICE_URL=http://localhost:8001 AUTH_TOKEN=your-token k6 run apps/order-service/tests/load/orders.load.js
```

### 7.3 Success Criteria

| Metric | Target | Pass Criteria |
|--------|--------|---------------|
| API p95 latency | < 200ms | 95% of requests under 200ms |
| Error rate | < 1% | Less than 1% failed requests |
| Concurrent users | 1000 | System handles 1000 concurrent users |
| Memory usage | < 512MB | Node.js process stays under 512MB |

### 7.4 Rollback Procedure

If load tests reveal performance issues:
1. Identify bottleneck from k6 output
2. Scale horizontally (add more instances)
3. Add database read replicas
4. Increase cache TTL
5. Re-run tests to validate improvement

---

## Step 8: Deployment Validation

### 8.1 Pre-deployment checklist

| Item | Status |
|------|--------|
| All TypeScript compilation passes | ☐ |
| Unit tests pass (90%+ coverage) | ☐ |
| Integration tests pass | ☐ |
| E2E tests pass | ☐ |
| Load tests pass (1000 concurrent) | ☐ |
| SSE endpoint tested and verified | ☐ |
| Push notification flow tested | ☐ |
| Carrier integration configured | ☐ |
| Database indexes created | ☐ |
| Environment variables set | ☐ |

### 8.2 Deployment steps

1. **Deploy order-service first:**
   ```bash
   cd apps/order-service
   pnpm build
   # Deploy to production
   ```

2. **Deploy client app:**
   ```bash
   cd apps/client
   pnpm build
   # Deploy to production
   ```

3. **Deploy admin app:**
   ```bash
   cd apps/admin
   pnpm build
   # Deploy to production
   ```

### 8.3 Post-deployment validation

```bash
# Verify SSE endpoint
curl -N "https://your-order-service.com/orders/stream?userId=test-user"

# Verify order detail page
curl "https://your-client-app.com/orders/test-order-id"

# Verify admin order page
curl "https://your-admin-app.com/orders"

# Check SSE connection stats
curl "https://your-order-service.com/orders/stream/stats"
```

### 8.4 Monitoring setup

Add to your monitoring dashboard:
- SSE active connections count
- API response time p95
- Error rate by endpoint
- Carrier API success rate
- Push notification delivery rate

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `apps/order-service/src/routes/sse.ts` | Created | SSE endpoint for real-time order updates |
| `apps/order-service/src/index.ts` | Modified | Registered SSE route, added carrier polling job |
| `apps/order-service/src/routes/order.ts` | Modified | Added SSE notifications to status updates |
| `apps/client/src/hooks/useSSE.ts` | Created | SSE client hook with reconnection and fallback |
| `apps/client/src/app/orders/[id]/client.tsx` | Modified | Integrated SSE for real-time updates |
| `apps/client/src/utils/pushNotifications.ts` | Created | Push notification subscription utility |
| `apps/client/public/sw.js` | Created | Service worker for push notifications |
| `apps/client/src/app/api/push/subscribe/route.ts` | Created | Push subscription API endpoint |
| `apps/client/src/app/api/push/unsubscribe/route.ts` | Created | Push unsubscribe API endpoint |
| `apps/order-service/src/utils/carrierTracking.ts` | Created | Carrier API integration (DHL, FedEx, UPS, USPS) |
| `apps/order-service/src/utils/estimatedDelivery.ts` | Created | ETA calculation utility |
| `apps/order-service/src/utils/order.ts` | Modified | Added ETA calculation to order creation |
| `packages/order-db/src/order-model.ts` | Modified | Added database indexes |
| `apps/order-service/src/utils/cache.ts` | Created | In-memory response cache |
| `apps/order-service/tests/load/orders.load.js` | Created | k6 load test script |

---

## Next Steps

After completing Phase 5, proceed to Phase 6: Rollout (Weeks 11-13) as defined in the main redesign plan.
| Concurrent users | 1000 | System handles 1000 concurrent users |
| Memory usage | < 512MB | Node.js process stays under 512MB |

### 7.4 Rollback Procedure

If load tests reveal performance issues:
1. Identify bottleneck from k6 output
2. Scale horizontally (add more instances)
3. Add database read replicas
4. Increase cache TTL
5. Re-run tests to validate improvement

---

## Step 8: Deployment Validation

### 8.1 Pre-deployment checklist

| Item | Status |
|------|--------|
| All TypeScript compilation passes | ☐ |
| Unit tests pass (90%+ coverage) | ☐ |
| Integration tests pass | ☐ |
| E2E tests pass | ☐ |
| Load tests pass (1000 concurrent) | ☐ |
| SSE endpoint tested and verified | ☐ |
| Push notification flow tested | ☐ |
| Carrier integration configured | ☐ |
| Database indexes created | ☐ |
| Environment variables set | ☐ |

### 8.2 Deployment steps

1. **Deploy order-service first:**
   ```bash
   cd apps/order-service
   pnpm build
   # Deploy to production
   ```

2. **Deploy client app:**
   ```bash
   cd apps/client
   pnpm build
   # Deploy to production
   ```

3. **Deploy admin app:**
   ```bash
   cd apps/admin
   pnpm build
   # Deploy to production
   ```

### 8.3 Post-deployment validation

```bash
# Verify SSE endpoint
curl -N "https://your-order-service.com/orders/stream?userId=test-user"

# Verify order detail page
curl "https://your-client-app.com/orders/test-order-id"

# Verify admin order page
curl "https://your-admin-app.com/orders"

# Check SSE connection stats
curl "https://your-order-service.com/orders/stream/stats"
```

### 8.4 Monitoring setup

Add to your monitoring dashboard:
- SSE active connections count
- API response time p95
- Error rate by endpoint
- Carrier API success rate
- Push notification delivery rate

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `apps/order-service/src/routes/sse.ts` | Created | SSE endpoint for real-time order updates |
| `apps/order-service/src/index.ts` | Modified | Registered SSE route, added carrier polling job |
| `apps/order-service/src/routes/order.ts` | Modified | Added SSE notifications to status updates |
| `apps/client/src/hooks/useSSE.ts` | Created | SSE client hook with reconnection and fallback |
| `apps/client/src/app/orders/[id]/client.tsx` | Modified | Integrated SSE for real-time updates |
| `apps/client/src/utils/pushNotifications.ts` | Created | Push notification subscription utility |
| `apps/client/public/sw.js` | Created | Service worker for push notifications |
| `apps/client/src/app/api/push/subscribe/route.ts` | Created | Push subscription API endpoint |
| `apps/client/src/app/api/push/unsubscribe/route.ts` | Created | Push unsubscribe API endpoint |
| `apps/order-service/src/utils/carrierTracking.ts` | Created | Carrier API integration (DHL, FedEx, UPS, USPS) |
| `apps/order-service/src/utils/estimatedDelivery.ts` | Created | ETA calculation utility |
| `apps/order-service/src/utils/order.ts` | Modified | Added ETA calculation to order creation |
| `packages/order-db/src/order-model.ts` | Modified | Added database indexes |
| `apps/order-service/src/utils/cache.ts` | Created | In-memory response cache |
| `apps/order-service/tests/load/orders.load.js` | Created | k6 load test script |

---

## Next Steps

After completing Phase 5, proceed to Phase 6: Rollout (Weeks 11-13) as defined in the main redesign plan.

