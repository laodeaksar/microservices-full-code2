# Phase 1 Implementation Guide: Foundation

**Goal:** Extend data model and build state machine infrastructure for the order status flow redesign.

---

## Step 1: Extend OrderSchema with New Fields

**File:** [`packages/order-db/src/order-model.ts`](packages/order-db/src/order-model.ts)

### 1.1 Replace the entire file content

Replace the existing schema with the extended schema that includes all new fields for payment tracking, shipping, audit logging, and notifications.

```typescript
import mongoose, { InferSchemaType, model } from "mongoose";
const { Schema } = mongoose;

export const OrderStatus = [
  "pending",
  "payment_pending",
  "payment_processing",
  "payment_confirmed",
  "payment_failed",
  "confirmed",
  "processing",
  "partially_shipped",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
  "delivery_exception",
  "return_requested",
  "return_in_progress",
  "return_completed",
] as const;

const OrderSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: OrderStatus,
      default: "pending",
    },

    // Payment details
    paymentIntentId: { type: String },
    paymentMethod: { type: String },
    paymentCompletedAt: { type: Date },

    // Shipping details
    shippingAddress: {
      fullName: { type: String },
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      state: { type: String },
      postalCode: { type: String },
      country: { type: String },
      phone: { type: String },
    },
    estimatedDeliveryDate: { type: Date },
    actualDeliveryDate: { type: Date },

    // Shipment tracking
    shipments: [
      {
        trackingNumber: { type: String },
        carrier: { type: String },
        items: [{ productId: String, quantity: Number }],
        shippedAt: { type: Date },
        deliveredAt: { type: Date },
        status: { type: String },
      },
    ],

    // Cancellation details
    cancellationReason: { type: String },
    cancelledBy: { type: String }, // "user" or "admin"
    cancelledAt: { type: Date },

    // Refund details
    refunds: [
      {
        amount: { type: Number },
        reason: { type: String },
        refundIntentId: { type: String },
        status: { type: String },
        createdAt: { type: Date },
      },
    ],

    // Products with per-item status for partial shipments
    products: {
      type: [
        {
          name: { type: String, required: true },
          quantity: { type: Number, required: true },
          price: { type: Number, required: true },
          status: {
            type: String,
            enum: ["pending", "shipped", "delivered", "refunded"],
            default: "pending",
          },
          shipmentId: { type: String },
        },
      ],
      required: true,
    },

    // Status change audit log
    statusHistory: [
      {
        from: { type: String },
        to: { type: String },
        reason: { type: String },
        changedBy: { type: String, default: "system" }, // "system", "user", "admin"
        changedAt: { type: Date, default: Date.now },
      },
    ],

    // Notification preferences
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

export type OrderSchemaType = InferSchemaType<typeof OrderSchema>;

export const Order = model<OrderSchemaType>("Order", OrderSchema);
```

### 1.2 Required Imports/Dependencies

No new external dependencies are required. The schema uses only `mongoose` which is already a dependency in `packages/order-db`.

### 1.3 Database Schema Synchronization

After updating the schema, run the following command to ensure TypeScript types are regenerated:

```bash
cd packages/order-db && pnpm build
```

### 1.4 Local Testing

Verify the schema compiles without errors:

```bash
cd packages/order-db && pnpm tsc --noEmit
```

Expected output: No errors.

---

## Step 2: Update OrderType Definitions

**File:** [`packages/types/src/order.ts`](packages/types/src/order.ts)

### 2.1 Replace the entire file content

Update the type definitions to include the new extended order types, status categories, and helper types for the Phase 1 implementation.

```typescript
import { OrderSchemaType } from "@repo/order-db";

// Base order type from schema
export type OrderType = OrderSchemaType & {
  _id: string;
};

// Order status type for type-safe status values
export type OrderStatusType =
  | "pending"
  | "payment_pending"
  | "payment_processing"
  | "payment_confirmed"
  | "payment_failed"
  | "confirmed"
  | "processing"
  | "partially_shipped"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "delivery_exception"
  | "return_requested"
  | "return_in_progress"
  | "return_completed";

// Status category for grouping statuses
export type OrderStatusCategory =
  | "pre_payment"
  | "payment"
  | "processing"
  | "fulfillment"
  | "completed"
  | "terminal"
  | "exception";

// Status change request payload
export type StatusChangeRequest = {
  status: OrderStatusType;
  reason?: string;
  changedBy?: "system" | "user" | "admin";
};

// Status change response payload
export type StatusChangeResponse = {
  success: boolean;
  order: OrderType;
  previousStatus: OrderStatusType;
  newStatus: OrderStatusType;
};

// Shipment type for tracking information
export type ShipmentType = {
  trackingNumber?: string;
  carrier?: string;
  items?: { productId: string; quantity: number }[];
  shippedAt?: Date;
  deliveredAt?: Date;
  status?: string;
};

// Refund type for refund tracking
export type RefundType = {
  amount?: number;
  reason?: string;
  refundIntentId?: string;
  status?: string;
  createdAt?: Date;
};

// Status history entry type
export type StatusHistoryEntry = {
  from?: string;
  to?: string;
  reason?: string;
  changedBy?: string;
  changedAt?: Date;
};

// Chart and dashboard types (existing)
export type OrderChartType = {
  month: string;
  total: number;
  successful: number;
};

export type OrderStatusDistribution = {
  status: string;
  count: number;
  fill: string;
};

export type DailyOrderTrend = {
  date: string;
  orders: number;
  revenue: number;
};

export type DashboardStats = {
  totalOrders: number;
  totalRevenue: number;
  successRate: number;
  averageOrderValue: number;
  ordersToday: number;
  revenueToday: number;
};
```

### 2.2 Required Imports/Dependencies

No new external dependencies. Uses existing `@repo/order-db` package reference.

### 2.3 Build and Test

```bash
cd packages/types && pnpm build
```

Verify TypeScript compilation:

```bash
cd packages/types && pnpm tsc --noEmit
```

---

## Step 3: Build State Machine Service

**File:** `apps/order-service/src/utils/stateMachine.ts` (NEW FILE)

### 3.1 Create the state machine file

Create a new file that implements the order status state machine with transition validation.

```typescript
import { OrderStatusType } from "@repo/types";

/**
 * Valid state transitions for order status.
 * Each key is a status, and the value is an array of statuses it can transition to.
 */
export const VALID_TRANSITIONS: Record<OrderStatusType, OrderStatusType[]> = {
  pending: ["payment_pending", "cancelled"],
  payment_pending: ["payment_processing", "cancelled"],
  payment_processing: ["payment_confirmed", "payment_failed"],
  payment_failed: ["payment_pending", "cancelled"],
  payment_confirmed: ["confirmed", "refunded", "cancelled"],
  confirmed: ["processing", "cancelled", "refunded"],
  processing: ["partially_shipped", "shipped", "cancelled", "refunded"],
  partially_shipped: ["shipped", "refunded", "partially_refunded"],
  shipped: ["out_for_delivery", "delivery_exception", "refunded"],
  out_for_delivery: ["delivered", "delivery_exception"],
  delivered: ["return_requested", "refunded"],
  cancelled: [], // Terminal state
  refunded: [], // Terminal state
  partially_refunded: [], // Terminal state
  delivery_exception: ["out_for_delivery", "refunded"],
  return_requested: ["return_in_progress", "cancelled"],
  return_in_progress: ["return_completed", "partially_refunded"],
  return_completed: [], // Terminal state
};

/**
 * Status categories for grouping and display purposes.
 */
export const STATUS_CATEGORIES: Record<OrderStatusType, string> = {
  pending: "pre_payment",
  payment_pending: "pre_payment",
  payment_processing: "payment",
  payment_confirmed: "payment",
  payment_failed: "payment",
  confirmed: "processing",
  processing: "processing",
  partially_shipped: "fulfillment",
  shipped: "fulfillment",
  out_for_delivery: "fulfillment",
  delivered: "completed",
  cancelled: "terminal",
  refunded: "terminal",
  partially_refunded: "terminal",
  delivery_exception: "exception",
  return_requested: "exception",
  return_in_progress: "exception",
  return_completed: "terminal",
};

/**
 * User-facing labels for each status.
 */
export const STATUS_LABELS: Record<OrderStatusType, string> = {
  pending: "Awaiting Payment",
  payment_pending: "Complete Your Payment",
  payment_processing: "Payment Processing",
  payment_confirmed: "Payment Confirmed",
  payment_failed: "Payment Failed",
  confirmed: "Order Confirmed",
  processing: "Processing",
  partially_shipped: "Partially Shipped",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
  partially_refunded: "Partially Refunded",
  delivery_exception: "Delivery Issue",
  return_requested: "Return Requested",
  return_in_progress: "Return in Progress",
  return_completed: "Return Completed",
};

/**
 * Custom error for invalid state transitions.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public from: OrderStatusType,
    public to: OrderStatusType,
    message?: string,
  ) {
    super(
      message ||
        `Invalid transition from "${from}" to "${to}"`,
    );
    this.name = "InvalidTransitionError";
  }
}

/**
 * Validates if a state transition is allowed.
 *
 * @param from - Current order status
 * @param to - Target order status
 * @returns true if the transition is valid
 * @throws InvalidTransitionError if the transition is not allowed
 */
export function validateTransition(
  from: OrderStatusType,
  to: OrderStatusType,
): boolean {
  const allowedTransitions = VALID_TRANSITIONS[from];

  if (!allowedTransitions || !allowedTransitions.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }

  return true;
}

/**
 * Gets all valid next statuses for a given status.
 *
 * @param status - Current order status
 * @returns Array of valid next statuses
 */
export function getValidNextStatuses(status: OrderStatusType): OrderStatusType[] {
  return VALID_TRANSITIONS[status] || [];
}

/**
 * Checks if a status is a terminal state (no further transitions allowed).
 *
 * @param status - Order status to check
 * @returns true if the status is terminal
 */
export function isTerminalStatus(status: OrderStatusType): boolean {
  const nextStatuses = getValidNextStatuses(status);
  return nextStatuses.length === 0;
}

/**
 * Gets the category for a given status.
 *
 * @param status - Order status
 * @returns Status category string
 */
export function getStatusCategory(status: OrderStatusType): string {
  return STATUS_CATEGORIES[status] || "unknown";
}

/**
 * Gets the user-facing label for a given status.
 *
 * @param status - Order status
 * @returns User-facing label
 */
export function getStatusLabel(status: OrderStatusType): string {
  return STATUS_LABELS[status] || status;
}
```

### 3.2 Required Imports/Dependencies

No new external dependencies. Uses `@repo/types` which is already a workspace dependency.

### 3.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 4: Add Status Transition Validation Middleware

**File:** `apps/order-service/src/middleware/statusValidation.ts` (NEW FILE)

### 4.1 Create the validation middleware

Create a Fastify plugin that validates status transitions before allowing updates.

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Order } from "@repo/order-db";
import {
  validateTransition,
  InvalidTransitionError,
} from "../utils/stateMachine";
import { OrderStatusType, StatusChangeRequest } from "@repo/types";

/**
 * Fastify plugin for status transition validation.
 */
export const statusValidationPlugin = async (fastify: FastifyInstance) => {
  /**
   * Validates that the requested status transition is allowed.
   *
   * This middleware:
   * 1. Fetches the current order
   * 2. Validates the transition from current to new status
   * 3. Attaches the order and validated status to the request
   */
  fastify.addHook(
    "preHandler",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: StatusChangeRequest;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { status: newStatus, reason, changedBy } = request.body;

        // Fetch the current order
        const order = await Order.findById(id);
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        // Validate the transition
        try {
          validateTransition(order.status as OrderStatusType, newStatus);
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            return reply.status(400).send({
              error: "Invalid status transition",
              message: error.message,
              currentStatus: order.status,
              requestedStatus: newStatus,
            });
          }
          throw error;
        }

        // Attach validated data to request for downstream handlers
        (request as any).currentOrder = order;
        (request as any).validatedStatus = newStatus;
        (request as any).transitionReason = reason;
        (request as any).changedBy = changedBy || "system";
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return reply.status(400).send({
            error: "Invalid status transition",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
};
```

### 4.2 Required Imports/Dependencies

- `@repo/order-db` - For Order model
- `@repo/types` - For type definitions
- `../utils/stateMachine` - For transition validation

### 4.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 5: Add Status History Audit Logging

**File:** `apps/order-service/src/utils/auditLogger.ts` (NEW FILE)

### 5.1 Create the audit logger utility

Create a utility function that logs status changes to the order's statusHistory array.

```typescript
import { Order } from "@repo/order-db";
import { OrderStatusType } from "@repo/types";

/**
 * Audit log entry for status changes.
 */
export type AuditLogEntry = {
  from: OrderStatusType | null;
  to: OrderStatusType;
  reason?: string;
  changedBy: "system" | "user" | "admin";
  changedAt: Date;
};

/**
 * Records a status change in the order's status history.
 *
 * @param orderId - MongoDB ObjectId of the order
 * @param entry - Audit log entry details
 * @returns The updated order document
 */
export async function recordStatusChange(
  orderId: string,
  entry: AuditLogEntry,
) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // Initialize statusHistory if it doesn't exist
  if (!order.statusHistory) {
    order.statusHistory = [];
  }

  // Add the new entry
  order.statusHistory.push({
    from: entry.from,
    to: entry.to,
    reason: entry.reason,
    changedBy: entry.changedBy,
    changedAt: entry.changedAt || new Date(),
  });

  // Update the order status
  order.status = entry.to;

  // Set terminal state timestamps
  if (entry.to === "delivered") {
    order.actualDeliveryDate = entry.changedAt || new Date();
  }
  if (entry.to === "cancelled") {
    order.cancelledAt = entry.changedAt || new Date();
  }

  return order.save();
}

/**
 * Gets the status history for an order.
 *
 * @param orderId - MongoDB ObjectId of the order
 * @returns Array of status history entries
 */
export async function getStatusHistory(orderId: string) {
  const order = await Order.findById(orderId).select("statusHistory");
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  return order.statusHistory || [];
}
```

### 5.2 Required Imports/Dependencies

- `@repo/order-db` - For Order model

### 5.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 6: Refactor Order Route Handlers

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

### 6.1 Add new endpoints and update existing ones

Add the following new endpoints to the existing route file:

1. `PATCH /orders/:id/status` - Update order status with validation
2. `GET /orders/:id` - Get single order details
3. `GET /orders/:id/tracking` - Get tracking information
4. `GET /orders/:id/history` - Get status history

Add these imports at the top of the file:

```typescript
import {
  validateTransition,
  InvalidTransitionError,
  getStatusLabel,
} from "../utils/stateMachine";
import {
  recordStatusChange,
  getStatusHistory,
} from "../utils/auditLogger";
import { OrderStatusType, StatusChangeRequest } from "@repo/types";
```

Add the following route handlers before the closing `};` of the `orderRoute` function:

```typescript
  // Get single order by ID
  fastify.get(
    "/orders/:id",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const order = await Order.findById(id);
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }
        return reply.send(order);
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to fetch order",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Update order status with validation
  fastify.patch(
    "/orders/:id/status",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as StatusChangeRequest;
        const { status: newStatus, reason, changedBy } = body;

        // Fetch the current order
        const order = await Order.findById(id);
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        // Validate the transition
        try {
          validateTransition(order.status as OrderStatusType, newStatus);
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            return reply.status(400).send({
              error: "Invalid status transition",
              message: error.message,
              currentStatus: order.status,
              requestedStatus: newStatus,
            });
          }
          throw error;
        }

        // Record the status change (includes audit logging)
        const updatedOrder = await recordStatusChange(id, {
          from: order.status as OrderStatusType,
          to: newStatus,
          reason,
          changedBy: changedBy || "admin",
          changedAt: new Date(),
        });

        return reply.send({
          success: true,
          order: updatedOrder,
          previousStatus: order.status,
          newStatus,
          label: getStatusLabel(newStatus),
        });
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return reply.status(400).send({
            error: "Invalid status transition",
            message: error.message,
          });
        }
        return reply.status(500).send({
          error: "Failed to update order status",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Get order tracking information
  fastify.get(
    "/orders/:id/tracking",
    { preHandler: shouldBeUser },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const order = await Order.findById(id).select(
          "shipments status estimatedDeliveryDate actualDeliveryDate userId",
        );

        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        // Verify user owns this order
        if (order.userId !== request.userId) {
          return reply.status(403).send({
            error: "Unauthorized",
            message: "You can only view your own orders",
          });
        }

        return reply.send({
          status: order.status,
          label: getStatusLabel(order.status as OrderStatusType),
          shipments: order.shipments,
          estimatedDeliveryDate: order.estimatedDeliveryDate,
          actualDeliveryDate: order.actualDeliveryDate,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to fetch tracking info",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Get order status history
  fastify.get(
    "/orders/:id/history",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const history = await getStatusHistory(id);
        return reply.send({ history });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to fetch order history",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
```

### 6.2 Required Imports/Dependencies

Add these imports at the top of the file:

```typescript
import {
  validateTransition,
  InvalidTransitionError,
  getStatusLabel,
} from "../utils/stateMachine";
import {
  recordStatusChange,
  getStatusHistory,
} from "../utils/auditLogger";
import { OrderStatusType, StatusChangeRequest } from "@repo/types";
```

### 6.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 7: Refactor Order Creation Utility

**File:** [`apps/order-service/src/utils/order.ts`](apps/order-service/src/utils/order.ts)

### 7.1 Update the createOrder function

Update the order creation to include default status, initial status history entry, and proper typing.

```typescript
import { Order } from "@repo/order-db";
import { OrderType, OrderStatusType } from "@repo/types";
import { sendOrderEmail } from "./email";
import { recordStatusChange } from "./auditLogger";

export const createOrder = async (orderData: Partial<OrderType>) => {
  // Set default status if not provided
  const status = (orderData.status as OrderStatusType) || "pending";

  // Create the order document
  const newOrder = new Order({
    ...orderData,
    status,
    statusHistory: [
      {
        from: null,
        to: status,
        reason: "Order created",
        changedBy: "system",
        changedAt: new Date(),
      },
    ],
  });

  try {
    const savedOrder = await newOrder.save();

    // Send email notification
    await sendOrderEmail(
      savedOrder.email,
      savedOrder.amount,
      savedOrder.status,
    );

    return savedOrder;
  } catch (error) {
    console.error("Error creating order:", error);
    throw error;
  }
};

/**
 * Updates order status with audit logging.
 * Use this for programmatic status changes (e.g., from webhooks).
 */
export const updateOrderStatus = async (
  orderId: string,
  newStatus: OrderStatusType,
  reason?: string,
  changedBy: "system" | "user" | "admin" = "system",
) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // Validate transition
  validateTransition(order.status as OrderStatusType, newStatus);

  // Record the change with audit logging
  return recordStatusChange(orderId, {
    from: order.status as OrderStatusType,
    to: newStatus,
    reason,
    changedBy,
    changedAt: new Date(),
  });
};

// Re-export state machine functions for use by other modules
export { validateTransition, InvalidTransitionError } from "./stateMachine";
```

### 7.2 Required Imports/Dependencies

- `@repo/order-db` - For Order model
- `@repo/types` - For type definitions
- `./email` - For email notifications
- `./auditLogger` - For audit logging
- `./stateMachine` - For transition validation

### 7.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 8: Create Database Migration Script

**File:** `apps/order-service/src/scripts/migrate-order-status.ts` (NEW FILE)

### 8.1 Create the migration script

This script migrates existing orders from the old binary status (`success`/`failed`) to the new status model.

```typescript
/**
 * Database Migration Script: Order Status Migration
 *
 * Migrates existing orders from the old binary status model to the new
 * multi-state order status flow.
 *
 * Old Status -> New Status Mapping:
 * - "success" -> "delivered" (assuming fulfilled orders were delivered)
 * - "failed" -> "payment_failed"
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-order-status.ts
 *
 * IMPORTANT: Run this script ONCE after deploying the new schema.
 * Always backup your database before running migrations.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/orders";

async function migrateOrderStatus() {
  console.log("🚀 Starting order status migration...");
  console.log(`📦 Connecting to MongoDB at ${MONGODB_URI}`);

  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Get the orders collection
    const ordersCollection = mongoose.connection.collection("orders");

    // Get counts before migration
    const successCount = await ordersCollection.countDocuments({
      status: "success",
    });
    const failedCount = await ordersCollection.countDocuments({
      status: "failed",
    });
    const totalCount = await ordersCollection.countDocuments({});

    console.log(`📊 Orders before migration:`);
    console.log(`   - Total: ${totalCount}`);
    console.log(`   - success: ${successCount}`);
    console.log(`   - failed: ${failedCount}`);

    // Migrate "success" -> "delivered"
    const successResult = await ordersCollection.updateMany(
      { status: "success" },
      {
        $set: {
          status: "delivered",
          actualDeliveryDate: new Date(),
          statusHistory: [
            {
              from: null,
              to: "delivered",
              reason: "Migrated from legacy 'success' status",
              changedBy: "system",
              changedAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(`✅ Migrated ${successResult.modifiedCount} 'success' orders to 'delivered'`);

    // Migrate "failed" -> "payment_failed"
    const failedResult = await ordersCollection.updateMany(
      { status: "failed" },
      {
        $set: {
          status: "payment_failed",
          statusHistory: [
            {
              from: null,
              to: "payment_failed",
              reason: "Migrated from legacy 'failed' status",
              changedBy: "system",
              changedAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(`✅ Migrated ${failedResult.modifiedCount} 'failed' orders to 'payment_failed'`);

    // Initialize statusHistory for orders that don't have it
    const noHistoryResult = await ordersCollection.updateMany(
      { statusHistory: { $exists: false } },
      {
        $set: {
          statusHistory: [
            {
              from: null,
              to: "$status",
              reason: "Initialized during migration",
              changedBy: "system",
              changedAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(`✅ Initialized statusHistory for ${noHistoryResult.modifiedCount} orders`);

    // Get counts after migration
    const newStatusCounts = await ordersCollection.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();

    console.log(`📊 Orders after migration:`);
    newStatusCounts.forEach((item) => {
      console.log(`   - ${item._id}: ${item.count}`);
    });

    console.log("🎉 Order status migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  }
}

// Run migration
migrateOrderStatus();
```

### 8.2 Required Dependencies

Add `ts-node` as a dev dependency if not already present:

```bash
cd apps/order-service && pnpm add -D ts-node
```

### 8.3 Running the Migration

```bash
# Ensure you have a backup of your database first!

# Run the migration
cd apps/order-service
npx ts-node src/scripts/migrate-order-status.ts
```

### 8.4 Verification

After running the migration, verify the results:

```bash
# Connect to MongoDB and run:
db.orders.aggregate([
  { $group: { _id: "$status", count: { $sum: 1 } } }
])
```

Expected output: No orders with `success` or `failed` status. All orders should have new status values.

---

## Step 9: Write Unit Tests for State Machine

**File:** `apps/order-service/src/utils/__tests__/stateMachine.test.ts` (NEW FILE)

### 9.1 Create the test file

Create comprehensive unit tests for the state machine logic.

```typescript
import { describe, it, expect } from "vitest";
import {
  validateTransition,
  getValidNextStatuses,
  isTerminalStatus,
  getStatusCategory,
  getStatusLabel,
  InvalidTransitionError,
  VALID_TRANSITIONS,
  STATUS_CATEGORIES,
  STATUS_LABELS,
} from "../stateMachine";
import { OrderStatusType } from "@repo/types";

describe("State Machine", () => {
  describe("validateTransition", () => {
    it("should allow valid transitions", () => {
      expect(validateTransition("pending", "payment_pending")).toBe(true);
      expect(validateTransition("pending", "cancelled")).toBe(true);
      expect(validateTransition("payment_pending", "payment_processing")).toBe(true);
      expect(validateTransition("payment_processing", "payment_confirmed")).toBe(true);
      expect(validateTransition("payment_processing", "payment_failed")).toBe(true);
      expect(validateTransition("payment_confirmed", "confirmed")).toBe(true);
      expect(validateTransition("confirmed", "processing")).toBe(true);
      expect(validateTransition("processing", "shipped")).toBe(true);
      expect(validateTransition("shipped", "delivered")).toBe(false); // shipped -> out_for_delivery -> delivered
      expect(validateTransition("shipped", "out_for_delivery")).toBe(true);
      expect(validateTransition("out_for_delivery", "delivered")).toBe(true);
    });

    it("should throw InvalidTransitionError for invalid transitions", () => {
      expect(() => validateTransition("pending", "shipped")).toThrow(
        InvalidTransitionError,
      );
      expect(() => validateTransition("cancelled", "pending")).toThrow(
        InvalidTransitionError,
      );
      expect(() => validateTransition("delivered", "processing")).toThrow(
        InvalidTransitionError,
      );
      expect(() => validateTransition("refunded", "pending")).toThrow(
        InvalidTransitionError,
      );
    });

    it("should prevent transitions from terminal states", () => {
      const terminalStates: OrderStatusType[] = [
        "cancelled",
        "refunded",
        "partially_refunded",
        "return_completed",
      ];

      terminalStates.forEach((state) => {
        expect(() => validateTransition(state, "pending")).toThrow(
          InvalidTransitionError,
        );
      });
    });

    it("should allow retry from payment_failed", () => {
      expect(validateTransition("payment_failed", "payment_pending")).toBe(true);
      expect(validateTransition("payment_failed", "cancelled")).toBe(true);
    });

    it("should allow delivery exception recovery", () => {
      expect(
        validateTransition("delivery_exception", "out_for_delivery"),
      ).toBe(true);
      expect(validateTransition("delivery_exception", "refunded")).toBe(true);
    });
  });

  describe("getValidNextStatuses", () => {
    it("should return valid next statuses for pending", () => {
      const nextStatuses = getValidNextStatuses("pending");
      expect(nextStatuses).toContain("payment_pending");
      expect(nextStatuses).toContain("cancelled");
      expect(nextStatuses).toHaveLength(2);
    });

    it("should return valid next statuses for processing", () => {
      const nextStatuses = getValidNextStatuses("processing");
      expect(nextStatuses).toContain("partially_shipped");
      expect(nextStatuses).toContain("shipped");
      expect(nextStatuses).toContain("cancelled");
      expect(nextStatuses).toContain("refunded");
      expect(nextStatuses).toHaveLength(4);
    });

    it("should return empty array for terminal states", () => {
      expect(getValidNextStatuses("cancelled")).toEqual([]);
      expect(getValidNextStatuses("refunded")).toEqual([]);
      expect(getValidNextStatuses("partially_refunded")).toEqual([]);
    });
  });

  describe("isTerminalStatus", () => {
    it("should identify terminal states", () => {
      expect(isTerminalStatus("cancelled")).toBe(true);
      expect(isTerminalStatus("refunded")).toBe(true);
      expect(isTerminalStatus("partially_refunded")).toBe(true);
      expect(isTerminalStatus("return_completed")).toBe(true);
    });

    it("should identify non-terminal states", () => {
      expect(isTerminalStatus("pending")).toBe(false);
      expect(isTerminalStatus("processing")).toBe(false);
      expect(isTerminalStatus("shipped")).toBe(false);
      expect(isTerminalStatus("delivered")).toBe(false); // delivered can transition to returns
    });
  });

  describe("getStatusCategory", () => {
    it("should return correct category for pre_payment statuses", () => {
      expect(getStatusCategory("pending")).toBe("pre_payment");
      expect(getStatusCategory("payment_pending")).toBe("pre_payment");
    });

    it("should return correct category for payment statuses", () => {
      expect(getStatusCategory("payment_processing")).toBe("payment");
      expect(getStatusCategory("payment_confirmed")).toBe("payment");
      expect(getStatusCategory("payment_failed")).toBe("payment");
    });

    it("should return correct category for fulfillment statuses", () => {
      expect(getStatusCategory("partially_shipped")).toBe("fulfillment");
      expect(getStatusCategory("shipped")).toBe("fulfillment");
      expect(getStatusCategory("out_for_delivery")).toBe("fulfillment");
    });

    it("should return correct category for terminal statuses", () => {
      expect(getStatusCategory("cancelled")).toBe("terminal");
      expect(getStatusCategory("refunded")).toBe("terminal");
      expect(getStatusCategory("return_completed")).toBe("terminal");
    });
  });

  describe("getStatusLabel", () => {
    it("should return user-friendly labels", () => {
      expect(getStatusLabel("pending")).toBe("Awaiting Payment");
      expect(getStatusLabel("payment_confirmed")).toBe("Payment Confirmed");
      expect(getStatusLabel("shipped")).toBe("Shipped");
      expect(getStatusLabel("delivered")).toBe("Delivered");
      expect(getStatusLabel("delivery_exception")).toBe("Delivery Issue");
    });
  });

  describe("InvalidTransitionError", () => {
    it("should have correct error name and message", () => {
      const error = new InvalidTransitionError("pending", "shipped");
      expect(error.name).toBe("InvalidTransitionError");
      expect(error.message).toBe('Invalid transition from "pending" to "shipped"');
      expect(error.from).toBe("pending");
      expect(error.to).toBe("shipped");
    });

    it("should accept custom message", () => {
      const error = new InvalidTransitionError(
        "pending",
        "shipped",
        "Custom error message",
      );
      expect(error.message).toBe("Custom error message");
    });
  });

  describe("VALID_TRANSITIONS completeness", () => {
    it("should have entries for all OrderStatusType values", () => {
      const allStatuses: OrderStatusType[] = [
        "pending",
        "payment_pending",
        "payment_processing",
        "payment_confirmed",
        "payment_failed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refunded",
        "partially_refunded",
        "delivery_exception",
        "return_requested",
        "return_in_progress",
        "return_completed",
      ];

      allStatuses.forEach((status) => {
        expect(VALID_TRANSITIONS[status]).toBeDefined();
      });
    });
  });

  describe("STATUS_CATEGORIES completeness", () => {
    it("should have categories for all OrderStatusType values", () => {
      const allStatuses: OrderStatusType[] = [
        "pending",
        "payment_pending",
        "payment_processing",
        "payment_confirmed",
        "payment_failed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refunded",
        "partially_refunded",
        "delivery_exception",
        "return_requested",
        "return_in_progress",
        "return_completed",
      ];

      allStatuses.forEach((status) => {
        expect(STATUS_CATEGORIES[status]).toBeDefined();
      });
    });
  });

  describe("STATUS_LABELS completeness", () => {
    it("should have labels for all OrderStatusType values", () => {
      const allStatuses: OrderStatusType[] = [
        "pending",
        "payment_pending",
        "payment_processing",
        "payment_confirmed",
        "payment_failed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refunded",
        "partially_refunded",
        "delivery_exception",
        "return_requested",
        "return_in_progress",
        "return_completed",
      ];

      allStatuses.forEach((status) => {
        expect(STATUS_LABELS[status]).toBeDefined();
      });
    });
  });
});
```

### 9.2 Required Dependencies

Ensure `vitest` is installed as a dev dependency:

```bash
cd apps/order-service && pnpm add -D vitest
```

### 9.3 Running the Tests

Add a test script to `apps/order-service/package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Run the tests:

```bash
cd apps/order-service && pnpm test
```

Expected output: All tests passing with 90%+ coverage.

---

## Step 10: Integration Testing

### 10.1 Start the Order Service

```bash
cd apps/order-service && pnpm dev
```

### 10.2 Test New Endpoints

```bash
# Get single order
curl -H "Authorization: Bearer <token>" http://localhost:8001/orders/<order-id>

# Update order status
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "confirmed", "reason": "Manual confirmation", "changedBy": "admin"}' \
  http://localhost:8001/orders/<order-id>/status

# Get tracking info
curl -H "Authorization: Bearer <token>" http://localhost:8001/orders/<order-id>/tracking

# Get status history
curl -H "Authorization: Bearer <token>" http://localhost:8001/orders/<order-id>/history
```

### 10.3 Test Invalid Transitions

```bash
# This should return 400 Bad Request
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "delivered", "reason": "Invalid jump", "changedBy": "admin"}' \
  http://localhost:8001/orders/<order-id>/status
```

Expected response:

```json
{
  "error": "Invalid status transition",
  "message": "Invalid transition from \"pending\" to \"delivered\"",
  "currentStatus": "pending",
  "requestedStatus": "delivered"
}
```

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `packages/order-db/src/order-model.ts` | Modified | Extended schema with new statuses, shipments, statusHistory |
| `packages/types/src/order.ts` | Modified | Added new type definitions for status, shipments, refunds |
| `apps/order-service/src/utils/stateMachine.ts` | Created | State machine logic with transition validation |
| `apps/order-service/src/utils/auditLogger.ts` | Created | Audit logging utility for status changes |
| `apps/order-service/src/middleware/statusValidation.ts` | Created | Fastify middleware for status validation |
| `apps/order-service/src/routes/order.ts` | Modified | Added PATCH status endpoint, GET by ID, tracking, history |
| `apps/order-service/src/utils/order.ts` | Modified | Updated createOrder with audit logging, added updateOrderStatus |
| `apps/order-service/src/scripts/migrate-order-status.ts` | Created | Database migration script for legacy statuses |
| `apps/order-service/src/utils/__tests__/stateMachine.test.ts` | Created | Unit tests for state machine |

---

## Next Steps

After completing Phase 1, proceed to Phase 2: API & Notifications (Weeks 3-5) as defined in the main redesign plan.
