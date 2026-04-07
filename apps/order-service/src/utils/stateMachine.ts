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
