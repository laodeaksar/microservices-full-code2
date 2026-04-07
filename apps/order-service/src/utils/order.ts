import { Order } from "@repo/order-db";
import { OrderType } from "@repo/types";
import { sendOrderEmail } from "./email";

export const createOrder = async (orderData: Partial<OrderType>) => {
  // const newOrder = new Order(order);
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
    // Send email notification directly
    await sendOrderEmail(
      savedOrder.email,
      savedOrder.amount,
      savedOrder.status,
    );
    return savedOrder;
  } catch (error) {
    console.log(error);
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

