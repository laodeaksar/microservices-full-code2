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
    //@ts-ignore
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
