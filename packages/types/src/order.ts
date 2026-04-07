import { OrderSchemaType } from "@repo/order-db";

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
