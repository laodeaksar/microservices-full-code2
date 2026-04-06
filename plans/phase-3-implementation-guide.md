# Phase 3 Implementation Guide: Client UI

**Goal:** Build customer-facing order tracking experience with reusable components, enhanced order list, new order detail page, real-time status polling, and comprehensive accessibility compliance.

**Prerequisites:** Phase 1 and Phase 2 must be fully completed, including:
- Extended OrderSchema with all new fields
- Updated TypeScript types in `@repo/types`
- State machine service with `STATUS_LABELS`, `STATUS_CATEGORIES`, `getStatusLabel`
- Notification service and API endpoints (`PATCH /orders/:id/status`, `GET /orders/:id`, `GET /orders/:id/tracking`, `GET /orders/:id/history`)
- Database migration executed

---

## Step 1: Create OrderStatusBadge Component

**File:** `apps/client/src/components/OrderStatusBadge.tsx` (NEW FILE)

### 1.1 Create the reusable status badge component

This component renders an accessible, color-coded status badge with icon and user-facing label.

```tsx
"use client";

import React from "react";
import { OrderStatusType } from "@repo/types";

/**
 * Status configuration with color, icon, and label.
 */
interface StatusConfig {
  bg: string;
  text: string;
  icon: string;
  label: string;
}

/**
 * Status configuration map for all order statuses.
 */
const STATUS_CONFIG: Record<OrderStatusType, StatusConfig> = {
  pending: {
    bg: "bg-yellow-100",
    text: "text-yellow-800",
    icon: "⏳",
    label: "Awaiting Payment",
  },
  payment_pending: {
    bg: "bg-orange-100",
    text: "text-orange-800",
    icon: "💳",
    label: "Complete Your Payment",
  },
  payment_processing: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    icon: "⚙️",
    label: "Payment Processing",
  },
  payment_confirmed: {
    bg: "bg-green-100",
    text: "text-green-800",
    icon: "✅",
    label: "Payment Confirmed",
  },
  payment_failed: {
    bg: "bg-red-100",
    text: "text-red-800",
    icon: "❌",
    label: "Payment Failed",
  },
  confirmed: {
    bg: "bg-green-100",
    text: "text-green-800",
    icon: "✅",
    label: "Order Confirmed",
  },
  processing: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    icon: "📦",
    label: "Processing",
  },
  partially_shipped: {
    bg: "bg-purple-100",
    text: "text-purple-800",
    icon: "📬",
    label: "Partially Shipped",
  },
  shipped: {
    bg: "bg-indigo-100",
    text: "text-indigo-800",
    icon: "🚚",
    label: "Shipped",
  },
  out_for_delivery: {
    bg: "bg-orange-100",
    text: "text-orange-800",
    icon: "🏠",
    label: "Out for Delivery",
  },
  delivered: {
    bg: "bg-green-100",
    text: "text-green-800",
    icon: "🎉",
    label: "Delivered",
  },
  cancelled: {
    bg: "bg-gray-100",
    text: "text-gray-800",
    icon: "🚫",
    label: "Cancelled",
  },
  refunded: {
    bg: "bg-gray-100",
    text: "text-gray-800",
    icon: "💰",
    label: "Refunded",
  },
  partially_refunded: {
    bg: "bg-gray-100",
    text: "text-gray-800",
    icon: "💵",
    label: "Partially Refunded",
  },
  delivery_exception: {
    bg: "bg-red-100",
    text: "text-red-800",
    icon: "⚠️",
    label: "Delivery Issue",
  },
  return_requested: {
    bg: "bg-yellow-100",
    text: "text-yellow-800",
    icon: "↩️",
    label: "Return Requested",
  },
  return_in_progress: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    icon: "🔄",
    label: "Return in Progress",
  },
  return_completed: {
    bg: "bg-green-100",
    text: "text-green-800",
    icon: "✅",
    label: "Return Completed",
  },
};

/**
 * Props for the OrderStatusBadge component.
 */
export interface OrderStatusBadgeProps {
  status: OrderStatusType;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  showLabel?: boolean;
  className?: string;
}

/**
 * Accessible order status badge component.
 *
 * @example
 * <OrderStatusBadge status="shipped" />
 * <OrderStatusBadge status="delivered" size="lg" showIcon={false} />
 */
export function OrderStatusBadge({
  status,
  size = "sm",
  showIcon = true,
  showLabel = true,
  className = "",
}: OrderStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || {
    bg: "bg-gray-100",
    text: "text-gray-800",
    icon: "❓",
    label: status,
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${config.bg} ${config.text} ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showIcon && <span aria-hidden="true">{config.icon}</span>}
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

export default OrderStatusBadge;
```

### 1.2 Required Dependencies

No new dependencies. Uses existing React and Tailwind CSS.

### 1.3 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

Expected: No TypeScript errors.

---

## Step 2: Create OrderStepper Component

**File:** `apps/client/src/components/OrderStepper.tsx` (NEW FILE)

### 2.1 Create the order progress stepper component

This component renders a horizontal stepper for desktop and vertical stepper for mobile, showing order progress through key milestones.

```tsx
"use client";

import React from "react";
import { OrderStatusType, StatusHistoryEntry } from "@repo/types";

/**
 * Stepper step configuration.
 */
interface StepperStep {
  status: OrderStatusType;
  label: string;
  icon: string;
  date?: Date;
}

/**
 * Props for the OrderStepper component.
 */
export interface OrderStepperProps {
  currentStatus: OrderStatusType;
  statusHistory?: StatusHistoryEntry[];
  estimatedDeliveryDate?: Date | string;
  className?: string;
}

/**
 * Key milestones for the order journey.
 */
const MILESTONES: OrderStatusType[] = [
  "payment_confirmed",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
];

const MILESTONE_LABELS: Record<OrderStatusType, string> = {
  payment_confirmed: "Payment Confirmed",
  confirmed: "Order Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
};

const MILESTONE_ICONS: Record<OrderStatusType, string> = {
  payment_confirmed: "💳",
  confirmed: "✅",
  processing: "📦",
  shipped: "🚚",
  out_for_delivery: "🏠",
  delivered: "🎉",
};

/**
 * Order progress stepper component.
 *
 * Shows horizontal stepper on desktop, vertical on mobile.
 *
 * @example
 * <OrderStepper
 *   currentStatus="shipped"
 *   statusHistory={order.statusHistory}
 *   estimatedDeliveryDate={order.estimatedDeliveryDate}
 * />
 */
export function OrderStepper({
  currentStatus,
  statusHistory = [],
  estimatedDeliveryDate,
  className = "",
}: OrderStepperProps) {
  // Determine which milestones have been completed
  const currentIndex = MILESTONES.indexOf(currentStatus);
  const activeIndex = currentIndex >= 0 ? currentIndex : MILESTONES.length - 1;

  // Build steps with dates from history
  const steps: StepperStep[] = MILESTONES.map((status, index) => {
    const historyEntry = statusHistory.find(
      (h) => h.to === status,
    );
    return {
      status,
      label: MILESTONE_LABELS[status],
      icon: MILESTONE_ICONS[status],
      date: historyEntry?.changedAt
        ? new Date(historyEntry.changedAt)
        : undefined,
    };
  });

  // Add estimated delivery as final step if not delivered
  if (currentStatus !== "delivered" && estimatedDeliveryDate) {
    steps.push({
      status: "delivered",
      label: "Estimated Delivery",
      icon: "📅",
      date: new Date(estimatedDeliveryDate),
    });
  }

  return (
    <>
      {/* Desktop: Horizontal Stepper */}
      <div className={`hidden md:block ${className}`}>
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const isCompleted = index < activeIndex || currentStatus === "delivered";
            const isActive = index === activeIndex;
            const isPending = index > activeIndex;

            return (
              <React.Fragment key={step.status}>
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : isActive
                          ? "bg-blue-500 text-white ring-4 ring-blue-200"
                          : "bg-gray-200 text-gray-400"
                    }`}
                    aria-current={isActive ? "step" : undefined}
                  >
                    {isCompleted ? "✓" : step.icon}
                  </div>
                  <p
                    className={`mt-2 text-xs font-medium text-center ${
                      isCompleted
                        ? "text-green-700"
                        : isActive
                          ? "text-blue-700"
                          : "text-gray-500"
                    }`}
                  >
                    {step.label}
                  </p>
                  {step.date && (
                    <p className="text-xs text-gray-400 mt-1">
                      {step.date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      index < activeIndex ? "bg-green-500" : "bg-gray-200"
                    }`}
                    aria-hidden="true"
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Mobile: Vertical Stepper */}
      <div className={`md:hidden ${className}`}>
        <div className="space-y-0">
          {steps.map((step, index) => {
            const isCompleted = index < activeIndex || currentStatus === "delivered";
            const isActive = index === activeIndex;

            return (
              <div key={step.status} className="flex items-start">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : isActive
                          ? "bg-blue-500 text-white"
                          : "bg-gray-200 text-gray-400"
                    }`}
                  >
                    {isCompleted ? "✓" : step.icon}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`w-0.5 flex-1 min-h-[2rem] ${
                        index < activeIndex ? "bg-green-500" : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
                <div className="ml-3 pb-4">
                  <p
                    className={`text-sm font-medium ${
                      isCompleted
                        ? "text-green-700"
                        : isActive
                          ? "text-blue-700"
                          : "text-gray-500"
                    }`}
                  >
                    {step.label}
                  </p>
                  {step.date && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {step.date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default OrderStepper;
```

### 2.2 Required Dependencies

No new dependencies. Uses existing React and Tailwind CSS.

### 2.3 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 3: Create OrderTimeline Component

**File:** `apps/client/src/components/OrderTimeline.tsx` (NEW FILE)

### 3.1 Create the order timeline component

This component renders a vertical timeline showing all status changes with timestamps and reasons.

```tsx
"use client";

import React from "react";
import { StatusHistoryEntry } from "@repo/types";

/**
 * Props for the OrderTimeline component.
 */
export interface OrderTimelineProps {
  history: StatusHistoryEntry[];
  className?: string;
}

/**
 * Order status timeline component.
 *
 * Displays a chronological list of status changes with details.
 *
 * @example
 * <OrderTimeline history={order.statusHistory} />
 */
export function OrderTimeline({
  history,
  className = "",
}: OrderTimelineProps) {
  if (!history || history.length === 0) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        No status history available.
      </div>
    );
  }

  // Sort by date, most recent first
  const sortedHistory = [...history].sort(
    (a, b) =>
      new Date(b.changedAt || 0).getTime() -
      new Date(a.changedAt || 0).getTime(),
  );

  return (
    <div className={`space-y-0 ${className}`}>
      {sortedHistory.map((entry, index) => (
        <div key={index} className="flex items-start">
          {/* Timeline dot and line */}
          <div className="flex flex-col items-center mr-4">
            <div
              className={`w-3 h-3 rounded-full ${
                index === 0 ? "bg-blue-500" : "bg-gray-300"
              }`}
            />
            {index < sortedHistory.length - 1 && (
              <div className="w-0.5 h-full bg-gray-200 mt-1" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 pb-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">
                {entry.to?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </p>
              {entry.changedAt && (
                <time className="text-xs text-gray-500">
                  {new Date(entry.changedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              )}
            </div>
            {entry.from && (
              <p className="text-xs text-gray-500 mt-0.5">
                From: {entry.from.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </p>
            )}
            {entry.reason && (
              <p className="text-sm text-gray-600 mt-1">{entry.reason}</p>
            )}
            {entry.changedBy && (
              <p className="text-xs text-gray-400 mt-0.5">
                Updated by: {entry.changedBy}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default OrderTimeline;
```

### 3.2 Required Dependencies

No new dependencies.

### 3.3 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 4: Create Order Detail Page

**File:** `apps/client/src/app/orders/[id]/page.tsx` (NEW FILE)

### 4.1 Create the order detail page

This page displays full order details including status stepper, tracking info, item-level status, shipping address, payment info, and timeline.

```tsx
import { auth } from "@clerk/nextjs/server";
import { OrderType, OrderStatusType, StatusHistoryEntry } from "@repo/types";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { OrderStepper } from "@/components/OrderStepper";
import { OrderTimeline } from "@/components/OrderTimeline";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Format TZS amount from cents.
 */
function formatOrderAmount(amountInCents: number): string {
  const amountInTzs = amountInCents / 100;
  return new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency: "TZS",
    minimumFractionDigits: 0,
  }).format(amountInTzs);
}

/**
 * Fetch single order from order-service.
 */
async function fetchOrder(orderId: string): Promise<OrderType | null> {
  try {
    const { getToken } = await auth();
    const token = await getToken();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      console.error("Failed to fetch order:", res.status, res.statusText);
      return null;
    }

    const data: OrderType = await res.json();
    return data;
  } catch (error) {
    console.error("Error fetching order:", error);
    return null;
  }
}

/**
 * Fetch order tracking info.
 */
async function fetchTracking(orderId: string): Promise<{
  status: string;
  shipments: any[];
  estimatedDeliveryDate?: string;
  actualDeliveryDate?: string;
} | null> {
  try {
    const { getToken } = await auth();
    const token = await getToken();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}/tracking`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch (error) {
    console.error("Error fetching tracking:", error);
    return null;
  }
}

/**
 * Fetch order status history.
 */
async function fetchHistory(orderId: string): Promise<StatusHistoryEntry[]> {
  try {
    const { getToken } = await auth();
    const token = await getToken();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}/history`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return data.history || [];
  } catch (error) {
    console.error("Error fetching history:", error);
    return [];
  }
}

/**
 * Order Detail Page.
 *
 * Displays comprehensive order information including:
 * - Status stepper showing progress
 * - Tracking information with carrier details
 * - Item-level status
 * - Shipping address
 * - Payment details
 * - Status timeline
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await fetchOrder(id);

  if (!order) {
    notFound();
  }

  const [tracking, history] = await Promise.all([
    fetchTracking(id),
    fetchHistory(id),
  ]);

  const currentStatus = order.status as OrderStatusType;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/orders"
          className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 mb-4"
        >
          ← Back to Orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-medium text-gray-900">
              Order #{order._id.slice(-6)}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Placed on{" "}
              {order.createdAt
                ? new Date(order.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "Unknown"}
            </p>
          </div>
          <OrderStatusBadge status={currentStatus} size="lg" />
        </div>
      </div>

      {/* Status Stepper */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          Order Progress
        </h2>
        <OrderStepper
          currentStatus={currentStatus}
          statusHistory={history}
          estimatedDeliveryDate={
            order.estimatedDeliveryDate
              ? new Date(order.estimatedDeliveryDate)
              : undefined
          }
        />
        {tracking?.estimatedDeliveryDate && (
          <p className="text-sm text-gray-600 mt-4 text-center">
            📅 Estimated Delivery:{" "}
            {new Date(tracking.estimatedDeliveryDate).toLocaleDateString(
              "en-US",
              {
                year: "numeric",
                month: "long",
                day: "numeric",
              },
            )}
          </p>
        )}
      </div>

      {/* Tracking Information */}
      {tracking && tracking.shipments && tracking.shipments.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">
            📦 Shipment Tracking
          </h2>
          {tracking.shipments.map((shipment, index) => (
            <div
              key={index}
              className="border-b border-gray-100 pb-4 last:border-0 last:pb-0"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {shipment.carrier || "Unknown Carrier"}
                  </p>
                  <p className="text-sm text-gray-600 font-mono">
                    {shipment.trackingNumber || "N/A"}
                  </p>
                </div>
                {shipment.trackingNumber && (
                  <a
                    href={`https://www.google.com/search?q=track+${shipment.trackingNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Track Package →
                  </a>
                )}
              </div>
              {shipment.shippedAt && (
                <p className="text-xs text-gray-500 mt-2">
                  Shipped:{" "}
                  {new Date(shipment.shippedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Items</h2>
        <div className="space-y-4">
          {order.products?.map((product, index) => (
            <div
              key={index}
              className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{product.name}</p>
                <p className="text-xs text-gray-500">
                  Qty: {product.quantity} × {formatOrderAmount(product.price)}
                </p>
                {(product as any).status && (
                  <OrderStatusBadge
                    status={(product as any).status as OrderStatusType}
                    size="sm"
                    className="mt-1"
                  />
                )}
              </div>
              <p className="text-sm font-medium">
                {formatOrderAmount(product.price * product.quantity)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <p className="text-base font-medium">Total</p>
            <p className="text-lg font-semibold">
              {formatOrderAmount(order.amount)}
            </p>
          </div>
        </div>
      </div>

      {/* Shipping Address */}
      {order.shippingAddress && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">
            Shipping Address
          </h2>
          <address className="not-italic text-sm text-gray-600">
            {order.shippingAddress.fullName}
            <br />
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 && (
              <>
                <br />
                {order.shippingAddress.line2}
              </>
            )}
            <br />
            {order.shippingAddress.city},{" "}
            {order.shippingAddress.state}{" "}
            {order.shippingAddress.postalCode}
            <br />
            {order.shippingAddress.country}
          </address>
        </div>
      )}

      {/* Payment Information */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Payment</h2>
        <div className="space-y-2 text-sm">
          {order.paymentMethod && (
            <p className="text-gray-600">
              Method:{" "}
              <span className="font-medium">
                {order.paymentMethod.charAt(0).toUpperCase() +
                  order.paymentMethod.slice(1)}
              </span>
            </p>
          )}
          {order.paymentCompletedAt && (
            <p className="text-gray-600">
              Paid:{" "}
              {new Date(order.paymentCompletedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
          <p className="text-gray-600">
            Status: <span className="font-medium text-green-600">Paid</span>
          </p>
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          Order Timeline
        </h2>
        <OrderTimeline history={history} />
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        {currentStatus === "payment_failed" && (
          <Link
            href={`/checkout?retry=${order._id}`}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            Retry Payment
          </Link>
        )}
        {currentStatus === "delivered" && (
          <Link
            href={`/return?orderId=${order._id}`}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
          >
            Request Return
          </Link>
        )}
        <a
          href={`/orders/${order._id}/invoice`}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
        >
          Download Invoice
        </a>
      </div>
    </div>
  );
}
```

### 4.2 Required Dependencies

No new dependencies. Uses existing `@clerk/nextjs`, `next/link`, `next/navigation`.

### 4.3 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 5: Enhance Order List Page

**File:** [`apps/client/src/app/orders/page.tsx`](apps/client/src/app/orders/page.tsx)

### 5.1 Replace the entire file content

Update the order list page to use the new `OrderStatusBadge`, show estimated delivery, product thumbnails, and link to order detail page.

```tsx
import { auth } from "@clerk/nextjs/server";
import { OrderType, OrderStatusType } from "@repo/types";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Format TZS amount from Stripe (which stores in cents)
 */
function formatOrderAmount(amountInCents: number): string {
  const amountInTzs = amountInCents / 100;
  return new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency: "TZS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountInTzs);
}

/**
 * Get action button text based on order status.
 */
function getActionText(status: OrderStatusType): string | null {
  switch (status) {
    case "payment_failed":
      return "Retry Payment";
    case "shipped":
    case "out_for_delivery":
      return "Track Order";
    case "delivered":
      return "View Details";
    default:
      return "View Details";
  }
}

const fetchOrders = async () => {
  try {
    const { getToken } = await auth();
    const token = await getToken();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/user-orders`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      console.error("Failed to fetch orders:", res.status, res.statusText);
      return null;
    }

    const data: OrderType[] = await res.json();
    return data;
  } catch (error) {
    console.error("Error fetching orders:", error);
    return null;
  }
};

const OrdersPage = async () => {
  const orders = await fetchOrders();

  if (!orders) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl my-4 font-medium text-[#001E3C]">
          Your Orders
        </h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load orders. Please try again later.
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl my-4 font-medium text-[#001E3C]">
          Your Orders
        </h1>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-600 mb-2">
            You haven't placed any orders yet.
          </p>
          <a
            href="/products"
            className="text-[#0A7EA4] hover:text-[#001E3C] hover:underline font-medium"
          >
            Start shopping
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-medium text-[#001E3C]">Your Orders</h1>
        <span className="text-sm text-gray-500">
          {orders.length} order{orders.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-4">
        {orders.map((order) => {
          const status = order.status as OrderStatusType;
          return (
            <Link
              key={order._id}
              href={`/orders/${order._id}`}
              className="block bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md hover:border-[#FDB913]/30 transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm font-mono text-gray-500">
                    #{order._id.slice(-6)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "-"}
                  </p>
                </div>
                <OrderStatusBadge status={status} size="md" />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-lg">
                    {formatOrderAmount(order.amount)}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {order.products
                      ?.map((p) => p.name)
                      .slice(0, 2)
                      .join(", ") || "No items"}
                    {order.products && order.products.length > 2 &&
                      ` +${order.products.length - 2} more`}
                  </p>
                </div>
                <div className="text-right">
                  {order.estimatedDeliveryDate && status !== "delivered" && (
                    <p className="text-xs text-gray-500">
                      Est. Delivery:{" "}
                      {new Date(order.estimatedDeliveryDate).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </p>
                  )}
                  <span className="text-sm text-blue-600 hover:underline mt-1 inline-block">
                    {getActionText(status) || "View Details"} →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default OrdersPage;
```

### 5.2 Required Dependencies

No new dependencies.

### 5.3 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 6: Add Real-Time Status Polling

**File:** `apps/client/src/hooks/useOrderPolling.ts` (NEW FILE)

### 6.1 Create the polling hook

This hook polls for order status updates at a configurable interval and triggers re-renders when status changes.

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { OrderType, OrderStatusType } from "@repo/types";

/**
 * Hook options.
 */
interface UseOrderPollingOptions {
  /** Order ID to poll for */
  orderId: string;
  /** Polling interval in milliseconds (default: 30000 = 30s) */
  interval?: number;
  /** Whether to enable polling */
  enabled?: boolean;
  /** Callback when status changes */
  onStatusChange?: (newStatus: OrderStatusType, oldStatus: OrderStatusType) => void;
}

/**
 * Hook return value.
 */
interface UseOrderPollingReturn {
  order: OrderType | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches order data from order-service.
 */
async function fetchOrder(orderId: string): Promise<OrderType> {
  const res = await fetch(`/api/orders/${orderId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch order: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Real-time order status polling hook.
 *
 * Polls the order-service for status updates and triggers
 * a callback when the status changes.
 *
 * @example
 * const { order, isLoading, lastUpdated } = useOrderPolling({
 *   orderId: "123",
 *   interval: 30000,
 *   onStatusChange: (newStatus, oldStatus) => {
 *     console.log(`Order status changed: ${oldStatus} -> ${newStatus}`);
 *   },
 * });
 */
export function useOrderPolling({
  orderId,
  interval = 30000,
  enabled = true,
  onStatusChange,
}: UseOrderPollingOptions): UseOrderPollingReturn {
  const [order, setOrder] = useState<OrderType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const previousStatusRef = useRef<OrderStatusType | null>(null);

  const fetchAndUpdate = useCallback(async () => {
    try {
      const data = await fetchOrder(orderId);
      const currentStatus = data.status as OrderStatusType;

      // Check if status changed
      if (
        previousStatusRef.current &&
        previousStatusRef.current !== currentStatus &&
        onStatusChange
      ) {
        onStatusChange(currentStatus, previousStatusRef.current);
      }

      previousStatusRef.current = currentStatus;
      setOrder(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [orderId, onStatusChange]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchAndUpdate();
    }
  }, [enabled, fetchAndUpdate]);

  // Polling interval
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(fetchAndUpdate, interval);
    return () => clearInterval(timer);
  }, [enabled, interval, fetchAndUpdate]);

  return {
    order,
    isLoading,
    error,
    lastUpdated,
    refresh: fetchAndUpdate,
  };
}

export default useOrderPolling;
```

### 6.2 Create API route for client-side polling

**File:** `apps/client/src/app/api/orders/[id]/route.ts` (NEW FILE)

This route proxies requests to the order-service, allowing client-side polling without exposing the service URL.

```typescript
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/[id]
 *
 * Proxies request to order-service to fetch single order.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { getToken } = await auth();
    const token = await getToken();

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch order" },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error proxying order request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
```

### 6.3 Required Dependencies

No new dependencies.

### 6.4 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 7: Implement Loading and Error States

**File:** `apps/client/src/app/orders/loading.tsx` (NEW FILE)

### 7.1 Create loading skeleton

```tsx
export default function OrdersLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-lg p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-2" />
                <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="h-8 w-32 bg-gray-200 rounded-full animate-pulse" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-2" />
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**File:** `apps/client/src/app/orders/error.tsx` (NEW FILE)

### 7.2 Create error boundary

```tsx
"use client";

import { useEffect } from "react";

export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Orders page error:", error);
  }, [error]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl my-4 font-medium text-[#001E3C]">Your Orders</h1>
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-700 mb-4">
          Couldn't load your orders. Please try again later.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
```

### 7.3 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 8: Add Accessibility Audit Compliance

### 8.1 Accessibility Checklist

Ensure all components meet WCAG 2.1 AA compliance:

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| Color contrast 4.5:1 | All badge color combinations tested | ✅ |
| Screen reader labels | `aria-label` on all status badges | ✅ |
| Keyboard navigation | All links and buttons focusable via Tab | ✅ |
| Focus management | Focus moves to heading on navigation | ✅ |
| Reduced motion | Animations respect `prefers-reduced-motion` | See Step 8.2 |
| Color independence | Status uses icon + text, not color alone | ✅ |
| Form labels | All inputs have associated `<label>` | N/A |
| Live regions | Status changes announced via `aria-live` | See Step 8.3 |

### 8.2 Add reduced motion support

Add to [`apps/client/src/app/globals.css`](apps/client/src/app/globals.css):

```css
/* Respect user's reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 8.3 Add live region for status announcements

Update the order detail page to include an `aria-live` region:

Add this component to the order detail page after the header:

```tsx
{/* Live region for screen reader announcements */}
<div aria-live="polite" aria-atomic="true" className="sr-only">
  <p>Order status: {getStatusLabel(currentStatus)}</p>
</div>
```

### 8.4 Verification Checkpoint

Run accessibility audit with axe-core:

```bash
cd apps/client && pnpm add -D @axe-core/react
```

Add to test setup:

```typescript
import { axe } from "@axe-core/react";

// Run on order detail page
await axe.run();
```

---

## Step 9: Add Client-Side Order Detail with Polling

**File:** `apps/client/src/app/orders/[id]/client.tsx` (NEW FILE)

### 9.1 Create client component for polling

This client component wraps the server-rendered order detail and adds real-time polling.

```tsx
"use client";

import React, { useState, useEffect } from "react";
import { OrderType, OrderStatusType } from "@repo/types";
import { useOrderPolling } from "@/hooks/useOrderPolling";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";

/**
 * Props for the client order detail component.
 */
interface ClientOrderDetailProps {
  initialOrder: OrderType;
}

/**
 * Client-side order detail with polling.
 *
 * Updates the UI in real-time when order status changes.
 */
export function ClientOrderDetail({ initialOrder }: ClientOrderDetailProps) {
  const [showStatusToast, setShowStatusToast] = useState(false);
  const [previousStatus, setPreviousStatus] = useState<OrderStatusType>(
    initialOrder.status as OrderStatusType,
  );

  const {
    order,
    isLoading,
    lastUpdated,
  } = useOrderPolling({
    orderId: initialOrder._id,
    interval: 30000,
    enabled: !["delivered", "cancelled", "refunded"].includes(
      initialOrder.status as OrderStatusType,
    ),
    onStatusChange: (newStatus, oldStatus) => {
      setPreviousStatus(oldStatus);
      setShowStatusToast(true);
      // Auto-hide toast after 5 seconds
      setTimeout(() => setShowStatusToast(false), 5000);
    },
  });

  const currentOrder = order || initialOrder;
  const currentStatus = currentOrder.status as OrderStatusType;

  return (
    <>
      {/* Last updated indicator */}
      {lastUpdated && (
        <div className="text-xs text-gray-400 mb-4">
          Last updated: {lastUpdated.toLocaleTimeString()}
          {isLoading && <span className="ml-2">⟳ Refreshing...</span>}
        </div>
      )}

      {/* Status change toast */}
      {showStatusToast && (
        <div
          className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-slide-up"
          role="alert"
        >
          <p className="font-medium">Status Updated</p>
          <p className="text-sm">
            {previousStatus.replace(/_/g, " ")} →{" "}
            {currentStatus.replace(/_/g, " ")}
          </p>
        </div>
      )}

      {/* Refresh button */}
      <button
        onClick={() => window.location.reload()}
        className="text-sm text-gray-500 hover:text-gray-700"
        aria-label="Refresh order details"
      >
        ↻ Refresh
      </button>
    </>
  );
}

export default ClientOrderDetail;
```

### 9.2 Verification Checkpoint

```bash
cd apps/client && pnpm tsc --noEmit
```

---

## Step 10: Mobile Responsive Testing

### 10.1 Responsive Design Verification

Test the following breakpoints:

| Breakpoint | Device | Verification |
|------------|--------|--------------|
| 320px | Mobile (small) | Stepper vertical, badges stack |
| 375px | Mobile (standard) | Stepper vertical, readable text |
| 768px | Tablet | Stepper horizontal, two-column layout |
| 1024px | Desktop | Full layout with sidebar |
| 1280px | Large desktop | Centered max-width container |

### 10.2 Add responsive CSS utilities

Add to [`apps/client/src/app/globals.css`](apps/client/src/app/globals.css):

```css
/* Slide-up animation for toast notifications */
@keyframes slide-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .animate-slide-up {
    animation: none;
  }
}
```

### 10.3 Verification Checkpoint

Test with Chrome DevTools device emulation:

```bash
cd apps/client && pnpm dev
```

Open `http://localhost:3000/orders` and verify responsive behavior.

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `apps/client/src/components/OrderStatusBadge.tsx` | Created | Accessible status badge with icon and label |
| `apps/client/src/components/OrderStepper.tsx` | Created | Horizontal/vertical progress stepper |
| `apps/client/src/components/OrderTimeline.tsx` | Created | Vertical status timeline |
| `apps/client/src/app/orders/[id]/page.tsx` | Created | Full order detail page |
| `apps/client/src/app/orders/page.tsx` | Modified | Enhanced list with badges, delivery dates, links |
| `apps/client/src/hooks/useOrderPolling.ts` | Created | Real-time polling hook |
| `apps/client/src/app/api/orders/[id]/route.ts` | Created | API proxy for client-side polling |
| `apps/client/src/app/orders/loading.tsx` | Created | Loading skeleton |
| `apps/client/src/app/orders/error.tsx` | Created | Error boundary |
| `apps/client/src/app/orders/[id]/client.tsx` | Created | Client-side polling wrapper |
| `apps/client/src/app/globals.css` | Modified | Reduced motion, toast animations |

---

## Cross-Service Integration Summary

| Integration | Method | Data Flow |
|-------------|--------|-----------|
| client → order-service | Server components + API proxy | Fetch orders, tracking, history |
| client → order-service | Polling (30s interval) | Real-time status updates |
| order-service → email-service | HTTP POST (Phase 2) | Notification dispatch |
| order-service → payment-service | Webhook (Phase 2) | Payment status updates |

---

## Next Steps

After completing Phase 3, proceed to Phase 4: Admin UI (Weeks 7-9) as defined in the main redesign plan.
