import { Order } from "@repo/order-db";
import { OrderStatusType } from "@repo/types";
import { recordStatusChange } from "./auditLogger";
import { dispatchNotifications } from "./notifications";

/**
 * Finds orders that have been in payment_pending state for longer than the timeout.
 *
 * @param timeoutMinutes - Minutes before auto-cancel (default: 30)
 * @returns Array of expired orders
 */
export async function findExpiredPendingOrders(
  timeoutMinutes: number = 30,
) {
  const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  return Order.find({
    status: "payment_pending",
    createdAt: { $lt: cutoffTime },
  });
}

/**
 * Cancels a single order due to payment timeout.
 *
 * @param orderId - Order ID to cancel
 * @param reason - Cancellation reason
 * @returns The updated order
 */
export async function cancelOrderDueToTimeout(
  orderId: string,
  reason: string = "Payment timeout - auto-cancelled",
) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  const previousStatus = order.status as OrderStatusType;

  const updatedOrder = await recordStatusChange(orderId, {
    from: previousStatus,
    to: "cancelled",
    reason,
    changedBy: "system",
    changedAt: new Date(),
  });

  updatedOrder.cancellationReason = reason;
  updatedOrder.cancelledBy = "system";
  updatedOrder.cancelledAt = new Date();
  await updatedOrder.save();

  // Dispatch notification
  dispatchNotifications(
    updatedOrder.toObject(),
    previousStatus,
    "system",
  ).catch((err) =>
    console.error("Auto-cancel notification failed:", err),
  );

  return updatedOrder;
}

/**
 * Processes all expired pending orders.
 *
 * @param timeoutMinutes - Minutes before auto-cancel
 * @returns Number of orders cancelled
 */
export async function processExpiredPendingOrders(
  timeoutMinutes: number = 30,
): Promise<number> {
  const expiredOrders = await findExpiredPendingOrders(timeoutMinutes);
  let cancelledCount = 0;

  for (const order of expiredOrders) {
    try {
      await cancelOrderDueToTimeout(order._id.toString());
      cancelledCount++;
    } catch (error) {
      console.error(
        `Failed to auto-cancel order ${order._id}:`,
        error,
      );
    }
  }

  return cancelledCount;
}
