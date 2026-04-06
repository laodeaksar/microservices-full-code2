# Phase 4 Implementation Guide: Admin UI

**Goal:** Enhance admin order management capabilities with status filtering, order detail view, status change dialog, refund/cancel actions, bulk operations, internal notes feature, and comprehensive E2E testing.

**Prerequisites:** Phases 1–3 must be fully completed and integrated, including:
- Extended OrderSchema with all new fields (Phase 1)
- Updated TypeScript types in `@repo/types` (Phase 1)
- State machine service with transition validation (Phase 1)
- Audit logging utility (Phase 1)
- Notification service and API endpoints (Phase 2)
- `PATCH /orders/:id/status`, `GET /orders/:id`, `GET /orders/:id/history` endpoints (Phase 2)
- Client-side reusable components (`OrderStatusBadge`, `OrderStepper`, `OrderTimeline`) from Phase 3 (can be shared via `@repo/ui` or copied to admin)

---

## Step 1: Add Internal Notes Schema Field

**File:** [`packages/order-db/src/order-model.ts`](packages/order-db/src/order-model.ts)

### 1.1 Add internalNotes field to schema

Add the internal notes field to support admin-only annotations on orders.

Find the `notifications` field in the schema and add the following after it:

```typescript
    // Internal admin notes
    internalNotes: [
      {
        content: { type: String, required: true },
        createdBy: { type: String, required: true }, // Admin user ID
        createdAt: { type: Date, default: Date.now },
      },
    ],
```

### 1.2 Verification Checkpoint

```bash
cd packages/order-db && pnpm tsc --noEmit
```

---

## Step 2: Add Internal Notes API Endpoints

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

### 2.1 Add notes CRUD endpoints

Add the following route handlers for internal notes management:

```typescript
  // Add internal note to order
  fastify.post(
    "/orders/:id/notes",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as { content: string };

        const order = await Order.findById(id);
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        if (!order.internalNotes) {
          order.internalNotes = [];
        }

        // Get admin user ID from auth context
        const adminUserId = request.userId || "unknown-admin";

        order.internalNotes.push({
          content: body.content,
          createdBy: adminUserId,
          createdAt: new Date(),
        });

        await order.save();

        return reply.status(201).send({
          success: true,
          notes: order.internalNotes,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to add note",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Get internal notes for order
  fastify.get(
    "/orders/:id/notes",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const order = await Order.findById(id).select("internalNotes");

        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        return reply.send({ notes: order.internalNotes || [] });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to fetch notes",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Delete internal note
  fastify.delete(
    "/orders/:id/notes/:noteIndex",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id, noteIndex } = request.params as {
          id: string;
          noteIndex: string;
        };

        const order = await Order.findById(id);
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        const index = parseInt(noteIndex, 10);
        if (
          isNaN(index) ||
          !order.internalNotes ||
          index < 0 ||
          index >= order.internalNotes.length
        ) {
          return reply.status(404).send({
            error: "Note not found",
          });
        }

        order.internalNotes.splice(index, 1);
        await order.save();

        return reply.send({
          success: true,
          notes: order.internalNotes,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to delete note",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
```

### 2.2 Verification Checkpoint

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 3: Add Bulk Status Update Endpoint

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

### 3.1 Add bulk status update endpoint

```typescript
  // Bulk status update
  fastify.patch(
    "/orders/bulk/status",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const body = request.body as {
          orderIds: string[];
          status: OrderStatusType;
          reason?: string;
        };

        const { orderIds, status, reason } = body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return reply.status(400).send({
            error: "Invalid request",
            message: "orderIds array is required",
          });
        }

        const results = {
          success: [] as string[],
          failed: [] as { id: string; error: string }[],
        };

        for (const orderId of orderIds) {
          try {
            const order = await Order.findById(orderId);
            if (!order) {
              results.failed.push({
                id: orderId,
                error: "Order not found",
              });
              continue;
            }

            // Validate transition
            try {
              validateTransition(order.status as OrderStatusType, status);
            } catch (error) {
              if (error instanceof InvalidTransitionError) {
                results.failed.push({
                  id: orderId,
                  error: `Invalid transition: ${order.status} -> ${status}`,
                });
                continue;
              }
              throw error;
            }

            // Record status change
            const previousStatus = order.status as OrderStatusType;
            const updatedOrder = await recordStatusChange(orderId, {
              from: previousStatus,
              to: status,
              reason: reason || "Bulk update",
              changedBy: "admin",
              changedAt: new Date(),
            });

            // Dispatch notifications
            dispatchNotifications(
              updatedOrder.toObject(),
              previousStatus,
              "admin",
            ).catch((err) =>
              console.error("Notification dispatch failed:", err),
            );

            results.success.push(orderId);
          } catch (error) {
            results.failed.push({
              id: orderId,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        return reply.send({
          success: true,
          results,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to bulk update",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
```

### 3.2 Verification Checkpoint

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 4: Add Order Status Filter to Admin Table

**File:** [`apps/admin/src/app/(dashboard)/orders/columns.tsx`](apps/admin/src/app/(dashboard)/orders/columns.tsx)

### 4.1 Update columns with enhanced status display and filter

Replace the entire file content:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OrderType, OrderStatusType } from "@repo/types";
import { ColumnDef, FilterFn } from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal, ExternalLink } from "lucide-react";
import Link from "next/link";

/**
 * Status configuration for admin display.
 */
const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "outline", label: "Awaiting Payment" },
  payment_pending: { variant: "outline", label: "Payment Pending" },
  payment_processing: { variant: "outline", label: "Processing" },
  payment_confirmed: { variant: "default", label: "Payment Confirmed" },
  payment_failed: { variant: "destructive", label: "Payment Failed" },
  confirmed: { variant: "default", label: "Confirmed" },
  processing: { variant: "secondary", label: "Processing" },
  partially_shipped: { variant: "outline", label: "Partially Shipped" },
  shipped: { variant: "default", label: "Shipped" },
  out_for_delivery: { variant: "outline", label: "Out for Delivery" },
  delivered: { variant: "default", label: "Delivered" },
  cancelled: { variant: "destructive", label: "Cancelled" },
  refunded: { variant: "destructive", label: "Refunded" },
  partially_refunded: { variant: "outline", label: "Partially Refunded" },
  delivery_exception: { variant: "destructive", label: "Delivery Issue" },
  return_requested: { variant: "outline", label: "Return Requested" },
  return_in_progress: { variant: "secondary", label: "Return in Progress" },
  return_completed: { variant: "default", label: "Return Completed" },
};

/**
 * Custom filter function for multi-select status filtering.
 */
const statusFilterFn: FilterFn<OrderType> = (row, columnId, filterValue: string[]) => {
  if (!filterValue || filterValue.length === 0) return true;
  const status = row.getValue(columnId) as string;
  return filterValue.includes(status);
};

export const columns: ColumnDef<OrderType>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        checked={row.getIsSelected()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "_id",
    header: "Order ID",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.getValue<string>("_id").slice(-6)}
      </span>
    ),
  },
  {
    accessorKey: "email",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Customer Email
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="text-sm">{row.getValue<string>("email")}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      const config = STATUS_CONFIG[status] || {
        variant: "outline" as const,
        label: status,
      };

      return (
        <Badge variant={config.variant} className="text-xs">
          {config.label}
        </Badge>
      );
    },
    filterFn: statusFilterFn,
  },
  {
    accessorKey: "amount",
    header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("amount"));
      const formatted = new Intl.NumberFormat("en-TZ", {
        style: "currency",
        currency: "TZS",
        minimumFractionDigits: 0,
      }).format(amount / 100);

      return <div className="text-right font-medium">{formatted}</div>;
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Date
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const date = row.getValue("createdAt") as string;
      return (
        <span className="text-sm">
          {date
            ? new Date(date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "-"}
        </span>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const order = row.original;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(order._id)}
            >
              Copy order ID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/orders/${order._id}`} className="cursor-pointer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/users/${order.userId}`} className="cursor-pointer">
                View customer
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
```

### 4.2 Verification Checkpoint

```bash
cd apps/admin && pnpm tsc --noEmit
```

---

## Step 5: Add Status Filter to Order Page

**File:** [`apps/admin/src/app/(dashboard)/orders/page.tsx`](apps/admin/src/app/(dashboard)/orders/page.tsx)

### 5.1 Update order page with status filter and search

Replace the entire file content:

```tsx
import { auth } from "@clerk/nextjs/server";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { OrderType, OrderStatusType } from "@repo/types";
import { Metadata } from "next";
import { Suspense } from "react";
import TableSkeleton from "@/components/skeletons/TableSkeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orders Management - Payments & Transactions",
  description:
    "Manage user orders and payments for Neurashop Tanzania. Track order status, payment details, and transaction history.",
  keywords:
    "order management, payment tracking, transactions, order status, payment history, e-commerce orders",
};

/**
 * All available order statuses for filter dropdown.
 */
const ORDER_STATUSES: { value: OrderStatusType; label: string }[] = [
  { value: "pending", label: "Awaiting Payment" },
  { value: "payment_pending", label: "Payment Pending" },
  { value: "payment_processing", label: "Payment Processing" },
  { value: "payment_confirmed", label: "Payment Confirmed" },
  { value: "payment_failed", label: "Payment Failed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "partially_shipped", label: "Partially Shipped" },
  { value: "shipped", label: "Shipped" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Partially Refunded" },
  { value: "delivery_exception", label: "Delivery Issue" },
  { value: "return_requested", label: "Return Requested" },
  { value: "return_in_progress", label: "Return in Progress" },
  { value: "return_completed", label: "Return Completed" },
];

const getData = async (): Promise<OrderType[]> => {
  try {
    const { getToken } = await auth();
    const token = await getToken();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders?limit=200`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );
    const data = await res.json();
    return data;
  } catch (err) {
    console.log(err);
    return [];
  }
};

const OrdersPage = async () => {
  const data = await getData();
  return (
    <div className="">
      <div className="mb-8 px-6 py-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Orders & Payments Management
        </h1>
        <p className="text-gray-600">
          Track and manage user orders, payments, and transaction history for
          Neurashop Tanzania.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <Input
          placeholder="Search by order ID or email..."
          className="max-w-sm"
          id="order-search-input"
        />
        <Select>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {ORDER_STATUSES.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Suspense fallback={<TableSkeleton rows={8} columns={7} />}>
        <DataTable columns={columns} data={data} />
      </Suspense>
    </div>
  );
};

export default OrdersPage;
```

### 5.2 Verification Checkpoint

```bash
cd apps/admin && pnpm tsc --noEmit
```

---

## Step 6: Create Admin Order Detail Page

**File:** `apps/admin/src/app/(dashboard)/orders/[id]/page.tsx` (NEW FILE)

### 6.1 Create the admin order detail page

```tsx
import { auth } from "@clerk/nextjs/server";
import { OrderType, OrderStatusType, StatusHistoryEntry } from "@repo/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Mail, Phone, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChangeDialog } from "@/components/StatusChangeDialog";
import { AdminNotesSection } from "@/components/AdminNotesSection";

export const dynamic = "force-dynamic";

/**
 * Status configuration for admin display.
 */
const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "outline", label: "Awaiting Payment" },
  payment_pending: { variant: "outline", label: "Payment Pending" },
  payment_processing: { variant: "outline", label: "Processing" },
  payment_confirmed: { variant: "default", label: "Payment Confirmed" },
  payment_failed: { variant: "destructive", label: "Payment Failed" },
  confirmed: { variant: "default", label: "Confirmed" },
  processing: { variant: "secondary", label: "Processing" },
  partially_shipped: { variant: "outline", label: "Partially Shipped" },
  shipped: { variant: "default", label: "Shipped" },
  out_for_delivery: { variant: "outline", label: "Out for Delivery" },
  delivered: { variant: "default", label: "Delivered" },
  cancelled: { variant: "destructive", label: "Cancelled" },
  refunded: { variant: "destructive", label: "Refunded" },
  partially_refunded: { variant: "outline", label: "Partially Refunded" },
  delivery_exception: { variant: "destructive", label: "Delivery Issue" },
  return_requested: { variant: "outline", label: "Return Requested" },
  return_in_progress: { variant: "secondary", label: "Return in Progress" },
  return_completed: { variant: "default", label: "Return Completed" },
};

/**
 * Format TZS amount.
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
      return null;
    }

    return res.json();
  } catch (error) {
    console.error("Error fetching order:", error);
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
 * Admin Order Detail Page.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [order, history] = await Promise.all([
    fetchOrder(id),
    fetchHistory(id),
  ]);

  if (!order) {
    notFound();
  }

  const currentStatus = order.status as OrderStatusType;
  const statusConfig = STATUS_CONFIG[currentStatus] || {
    variant: "outline" as const,
    label: currentStatus,
  };

  // Get valid next statuses for the status change dialog
  const validNextStatuses = getValidNextStatuses(currentStatus);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/orders">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Orders
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Order #{order._id.slice(-6)}
            </h1>
            <p className="text-sm text-gray-500">
              Placed{" "}
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
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusConfig.variant} className="text-sm px-3 py-1">
            {statusConfig.label}
          </Badge>
          <StatusChangeDialog
            orderId={order._id}
            currentStatus={currentStatus}
            validNextStatuses={validNextStatuses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.products?.map((product, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-gray-500">
                        Qty: {product.quantity} × {formatOrderAmount(product.price)}
                      </p>
                      {(product as any).status && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          {(product as any).status}
                        </Badge>
                      )}
                    </div>
                    <p className="font-medium">
                      {formatOrderAmount(product.price * product.quantity)}
                    </p>
                  </div>
                ))}
              </div>
              <Separator className="my-4" />
              <div className="flex justify-between">
                <span className="font-medium">Total</span>
                <span className="font-bold text-lg">
                  {formatOrderAmount(order.amount)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Status Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status History</CardTitle>
            </CardHeader>
            <CardContent>
              {history && history.length > 0 ? (
                <div className="space-y-4">
                  {history
                    .sort(
                      (a, b) =>
                        new Date(b.changedAt || 0).getTime() -
                        new Date(a.changedAt || 0).getTime(),
                    )
                    .map((entry, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="font-medium">
                              {entry.to?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                            </p>
                            {entry.changedAt && (
                              <time className="text-xs text-gray-500">
                                {new Date(entry.changedAt).toLocaleString()}
                              </time>
                            )}
                          </div>
                          {entry.reason && (
                            <p className="text-sm text-gray-600 mt-1">
                              {entry.reason}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-0.5">
                            By: {entry.changedBy || "system"}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No status history available.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Internal Notes */}
          <AdminNotesSection orderId={order._id} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="text-sm">{order.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">User ID:</span>
                <span className="text-xs font-mono">{order.userId}</span>
              </div>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link href={`/users/${order.userId}`}>View Customer</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Shipping Address */}
          {order.shippingAddress && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Shipping Address</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
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
                {order.shippingAddress.phone && (
                  <div className="flex items-center gap-2 mt-3">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="text-sm">{order.shippingAddress.phone}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payment Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-gray-500">Method</p>
                <p className="font-medium">
                  {order.paymentMethod
                    ? order.paymentMethod.charAt(0).toUpperCase() +
                      order.paymentMethod.slice(1)
                    : "N/A"}
                </p>
              </div>
              {order.paymentIntentId && (
                <div>
                  <p className="text-sm text-gray-500">Payment Intent</p>
                  <p className="text-xs font-mono">{order.paymentIntentId}</p>
                </div>
              )}
              {order.paymentCompletedAt && (
                <div>
                  <p className="text-sm text-gray-500">Paid</p>
                  <p className="text-sm">
                    {new Date(order.paymentCompletedAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tracking */}
          {order.shipments && order.shipments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Shipments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.shipments.map((shipment, index) => (
                  <div key={index} className="text-sm">
                    <p className="font-medium">
                      {shipment.carrier || "Unknown Carrier"}
                    </p>
                    <p className="font-mono text-xs">
                      {shipment.trackingNumber || "N/A"}
                    </p>
                    {shipment.shippedAt && (
                      <p className="text-xs text-gray-500 mt-1">
                        Shipped:{" "}
                        {new Date(shipment.shippedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Download Invoice
              </Button>
              <Button variant="outline" size="sm" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Print Packing Slip
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Get valid next statuses for a given status.
 * This mirrors the state machine logic from Phase 1.
 */
function getValidNextStatuses(status: OrderStatusType): OrderStatusType[] {
  const transitions: Record<OrderStatusType, OrderStatusType[]> = {
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
    cancelled: [],
    refunded: [],
    partially_refunded: [],
    delivery_exception: ["out_for_delivery", "refunded"],
    return_requested: ["return_in_progress", "cancelled"],
    return_in_progress: ["return_completed", "partially_refunded"],
    return_completed: [],
  };
  return transitions[status] || [];
}
```

### 6.2 Verification Checkpoint

```bash
cd apps/admin && pnpm tsc --noEmit
```

---

## Step 7: Create Status Change Dialog Component

**File:** `apps/admin/src/components/StatusChangeDialog.tsx` (NEW FILE)

### 7.1 Create the status change dialog

```tsx
"use client";

import { useState } from "react";
import { OrderStatusType } from "@repo/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

/**
 * Status label map.
 */
const STATUS_LABELS: Record<OrderStatusType, string> = {
  pending: "Awaiting Payment",
  payment_pending: "Payment Pending",
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
 * Props for the StatusChangeDialog component.
 */
interface StatusChangeDialogProps {
  orderId: string;
  currentStatus: OrderStatusType;
  validNextStatuses: OrderStatusType[];
  onSuccess?: () => void;
}

/**
 * Admin status change dialog component.
 *
 * Provides a modal with status selection dropdown, reason input,
 * and confirmation before updating order status.
 */
export function StatusChangeDialog({
  orderId,
  currentStatus,
  validNextStatuses,
  onSuccess,
}: StatusChangeDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatusType | "">("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { getToken } = useAuth();

  const handleSubmit = async () => {
    if (!selectedStatus) {
      toast.error("Please select a status");
      return;
    }

    setIsSubmitting(true);

    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: selectedStatus,
            reason: reason || "Manual status update",
            changedBy: "admin",
          }),
        },
      );

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update status");
      }

      toast.success(`Status updated to ${STATUS_LABELS[selectedStatus as OrderStatusType]}`);
      setOpen(false);
      setSelectedStatus("");
      setReason("");
      onSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update status",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change Status
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Update Order Status</DialogTitle>
          <DialogDescription>
            Change the status for order #{orderId.slice(-6)}. Current status:{" "}
            <strong>{STATUS_LABELS[currentStatus]}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="status">New Status</Label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status" />
              </SelectTrigger>
              <SelectContent>
                {validNextStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              placeholder="Enter reason for this status change..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedStatus}
          >
            {isSubmitting ? "Updating..." : "Update Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StatusChangeDialog;
```

### 7.2 Add missing UI components

Ensure the following shadcn/ui components are installed in the admin app:

```bash
cd apps/admin
pnpm dlx shadcn@latest add dialog textarea
```

### 7.3 Verification Checkpoint

```bash
cd apps/admin && pnpm tsc --noEmit
```

---

## Step 8: Create Admin Notes Section Component

**File:** `apps/admin/src/components/AdminNotesSection.tsx` (NEW FILE)

### 8.1 Create the admin notes component

```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { Trash2, Plus } from "lucide-react";

/**
 * Internal note type.
 */
interface InternalNote {
  content: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Props for the AdminNotesSection component.
 */
interface AdminNotesSectionProps {
  orderId: string;
}

/**
 * Admin internal notes section.
 *
 * Allows admins to add, view, and delete internal notes on orders.
 * Notes are only visible to admins.
 */
export function AdminNotesSection({ orderId }: AdminNotesSectionProps) {
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  const { getToken } = useAuth();

  // Fetch notes on mount
  useEffect(() => {
    fetchNotes();
  }, [orderId]);

  const fetchNotes = async () => {
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}/notes`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (error) {
      console.error("Failed to fetch notes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) {
      toast.error("Note content is required");
      return;
    }

    setIsAdding(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}/notes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: newNote }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
        setNewNote("");
        toast.success("Note added");
      } else {
        throw new Error("Failed to add note");
      }
    } catch (error) {
      toast.error("Failed to add note");
    } finally {
      setIsAdding(false);
    }
  };

  const deleteNote = async (index: number) => {
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}/notes/${index}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
        toast.success("Note deleted");
      } else {
        throw new Error("Failed to delete note");
      }
    } catch (error) {
      toast.error("Failed to delete note");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Internal Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-center py-4">Loading notes...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Internal Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Add note form */}
        <div className="mb-4">
          <Textarea
            placeholder="Add an internal note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
            className="mb-2"
          />
          <Button
            size="sm"
            onClick={addNote}
            disabled={isAdding || !newNote.trim()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {isAdding ? "Adding..." : "Add Note"}
          </Button>
        </div>

        {/* Notes list */}
        {notes.length > 0 ? (
          <div className="space-y-3">
            {notes.map((note, index) => (
              <div
                key={index}
                className="flex items-start justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <p className="text-sm">{note.content}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {note.createdBy} ·{" "}
                    {new Date(note.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteNote(index)}
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4 text-gray-400" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">No internal notes yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default AdminNotesSection;
```

### 8.2 Verification Checkpoint

```bash
cd apps/admin && pnpm tsc --noEmit
```

---

## Step 9: Add Bulk Actions to Data Table

**File:** [`apps/admin/src/app/(dashboard)/orders/data-table.tsx`](apps/admin/src/app/(dashboard)/orders/data-table.tsx)

### 9.1 Update data table with bulk status update

Replace the entire file content:

```tsx
"use client";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/TablePagination";
import { useState } from "react";
import { Trash2, CheckCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { OrderType, OrderStatusType } from "@repo/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<OrderStatusType | "">("");
  const [bulkReason, setBulkReason] = useState("");

  const { getToken } = useAuth();
  const router = useRouter();

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const selectedRows = table.getSelectedRowModel().rows;

      await Promise.all(
        selectedRows.map(async (row) => {
          const orderId = (row.original as OrderType)._id;
          await fetch(
            `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/${orderId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
        }),
      );
    },
    onSuccess: () => {
      toast.success("Order(s) deleted successfully");
      setRowSelection({});
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete orders");
    },
  });

  // Bulk status update mutation
  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const selectedRows = table.getSelectedRowModel().rows;
      const orderIds = selectedRows.map(
        (row) => (row.original as OrderType)._id,
      );

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_ORDER_SERVICE_URL}/orders/bulk/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            orderIds,
            status: bulkStatus,
            reason: bulkReason || "Bulk update",
          }),
        },
      );

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update orders");
      }

      return res.json();
    },
    onSuccess: (data) => {
      const { results } = data;
      toast.success(
        `Updated ${results.success.length} order(s). ${results.failed.length} failed.`,
      );
      setRowSelection({});
      setBulkDialogOpen(false);
      setBulkStatus("");
      setBulkReason("");
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update orders");
    },
  });

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      rowSelection,
    },
  });

  const selectedCount = Object.keys(rowSelection).length;

  return (
    <div className="rounded-md border">
      {/* Bulk action buttons */}
      {selectedCount > 0 && (
        <div className="flex justify-end gap-2 p-4">
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            onClick={() => setBulkDialogOpen(true)}
          >
            <CheckCircle className="w-4 h-4" />
            Update Status ({selectedCount})
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex items-center gap-2"
            onClick={() => {
              if (
                confirm(
                  `Are you sure you want to delete ${selectedCount} order${selectedCount > 1 ? "s" : ""}?`,
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="w-4 h-4" />
            {deleteMutation.isPending
              ? "Deleting..."
              : `Delete (${selectedCount})`}
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <DataTablePagination table={table} />

      {/* Bulk status update dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Bulk Status Update</DialogTitle>
            <DialogDescription>
              Update status for {selectedCount} selected order(s).
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="bulk-status">New Status</Label>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select new status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bulk-reason">Reason (optional)</Label>
              <Textarea
                id="bulk-reason"
                placeholder="Enter reason for this update..."
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkUpdateMutation.mutate()}
              disabled={bulkUpdateMutation.isPending || !bulkStatus}
            >
              {bulkUpdateMutation.isPending ? "Updating..." : "Update All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### 9.2 Verification Checkpoint

```bash
cd apps/admin && pnpm tsc --noEmit
```

---

## Step 10: Write E2E Tests for Admin Flows

**File:** `apps/admin/tests/orders.spec.ts` (NEW FILE)

### 10.1 Create Playwright E2E test file

```typescript
import { test, expect } from "@playwright/test";

test.describe("Admin Orders Management", () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin (adjust based on your auth setup)
    await page.goto("/sign-in");
    // ... login steps ...
  });

  test("should display orders list with status badges", async ({ page }) => {
    await page.goto("/orders");

    // Verify page loads
    await expect(page.getByText("Orders & Payments Management")).toBeVisible();

    // Verify status badges are displayed
    await expect(page.getByRole("cell", { name: /confirmed|shipped|delivered/i }).first()).toBeVisible();
  });

  test("should filter orders by status", async ({ page }) => {
    await page.goto("/orders");

    // Open status filter
    await page.getByText("Filter by status").click();

    // Select a status
    await page.getByText("Shipped").click();

    // Verify only shipped orders are shown
    await expect(page.getByText("Awaiting Payment")).not.toBeVisible();
  });

  test("should search orders by email", async ({ page }) => {
    await page.goto("/orders");

    // Enter search query
    await page.getByPlaceholder("Search by order ID or email...").fill("test@example.com");

    // Verify filtered results
    await expect(page.getByText("test@example.com")).toBeVisible();
  });

  test("should view order details", async ({ page }) => {
    await page.goto("/orders");

    // Click on first order
    await page.getByRole("row").nth(1).click();

    // Verify detail page loads
    await expect(page.getByText("Order #")).toBeVisible();
    await expect(page.getByText("Order Items")).toBeVisible();
  });

  test("should update order status via dialog", async ({ page }) => {
    await page.goto("/orders");

    // Navigate to order detail
    await page.getByRole("row").nth(1).click();

    // Click change status
    await page.getByText("Change Status").click();

    // Select new status
    await page.getByText("Processing").click();

    // Add reason
    await page.getByPlaceholder("Enter reason").fill("Test status update");

    // Submit
    await page.getByText("Update Status").click();

    // Verify success toast
    await expect(page.getByText("Status updated")).toBeVisible();
  });

  test("should add internal note", async ({ page }) => {
    await page.goto("/orders");
    await page.getByRole("row").nth(1).click();

    // Scroll to notes section
    await page.getByText("Internal Notes").scrollIntoViewIfNeeded();

    // Add note
    await page.getByPlaceholder("Add an internal note...").fill("Test note");
    await page.getByText("Add Note").click();

    // Verify note appears
    await expect(page.getByText("Test note")).toBeVisible();
  });

  test("should bulk update order status", async ({ page }) => {
    await page.goto("/orders");

    // Select multiple orders
    await page.getByRole("checkbox").nth(0).click(); // Select all
    await page.waitForTimeout(500);

    // Click bulk update
    await page.getByText("Update Status").click();

    // Select status
    await page.getByText("Processing").click();

    // Submit
    await page.getByText("Update All").click();

    // Verify success toast
    await expect(page.getByText(/Updated \d+ order/)).toBeVisible();
  });
});
```

### 10.2 Add Playwright dependencies

```bash
cd apps/admin
pnpm add -D @playwright/test
pnpm exec playwright install
```

### 10.3 Add test script to package.json

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

### 10.4 Run E2E tests

```bash
cd apps/admin && pnpm test:e2e
```

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `packages/order-db/src/order-model.ts` | Modified | Added `internalNotes` field |
| `apps/order-service/src/routes/order.ts` | Modified | Added notes CRUD, bulk status update endpoints |
| `apps/admin/src/app/(dashboard)/orders/page.tsx` | Modified | Added status filter and search |
| `apps/admin/src/app/(dashboard)/orders/columns.tsx` | Modified | Enhanced status display with badges, added filter function |
| `apps/admin/src/app/(dashboard)/orders/data-table.tsx` | Modified | Added bulk status update dialog |
| `apps/admin/src/app/(dashboard)/orders/[id]/page.tsx` | Created | Admin order detail page |
| `apps/admin/src/components/StatusChangeDialog.tsx` | Created | Status change modal with reason input |
| `apps/admin/src/components/AdminNotesSection.tsx` | Created | Internal notes CRUD UI |
| `apps/admin/tests/orders.spec.ts` | Created | Playwright E2E test suite |

---

## Deployment Considerations

### Database Migration

After adding `internalNotes` to the schema, no data migration is required since it's a new array field with default empty value.

### Environment Variables

Ensure the following environment variables are set for the admin app:

```bash
NEXT_PUBLIC_ORDER_SERVICE_URL=https://your-order-service-url.com
```

### Rollout Strategy

1. Deploy order-service changes first (new endpoints)
2. Deploy admin app changes
3. Verify E2E tests pass in staging
4. Gradual rollout to production

---

## Next Steps

After completing Phase 4, proceed to Phase 5: Real-Time & Polish (Weeks 9-11) as defined in the main redesign plan.
