import { OrderType, OrderStatusType } from "@repo/types";
import { getStatusLabel } from "./stateMachine";

/**
 * Notification channel types.
 */
export type NotificationChannel = "email" | "sms" | "push";

/**
 * Notification payload structure.
 */
export type NotificationPayload = {
  order: OrderType;
  trigger: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
};

/**
 * Service URLs from environment variables.
 */
const EMAIL_SERVICE_URL =
  process.env.EMAIL_SERVICE_URL || "http://localhost:8004";
const SMS_SERVICE_URL = process.env.SMS_SERVICE_URL || "";
const PUSH_SERVICE_URL = process.env.PUSH_SERVICE_URL || "";

/**
 * Sends a notification via the specified channel.
 *
 * @param payload - Notification details
 * @returns Promise that resolves when notification is sent
 */
async function sendNotification(payload: NotificationPayload): Promise<void> {
  const { order, channel, subject, body } = payload;

  try {
    switch (channel) {
      case "email":
        await sendEmailNotification(order.email, subject, body, order);
        break;
      case "sms":
        await sendSmsNotification(order, body);
        break;
      case "push":
        await sendPushNotification(order, subject, body);
        break;
      default:
        console.warn(`Unknown notification channel: ${channel}`);
    }
  } catch (error) {
    console.error(
      `Failed to send ${channel} notification for order ${order._id}:`,
      error,
    );
    // Don't throw - notification failure shouldn't break order processing
  }
}

/**
 * Sends an email notification via the email-service.
 */
async function sendEmailNotification(
  email: string,
  subject: string,
  body: string,
  order: OrderType,
): Promise<void> {
  const response = await fetch(`${EMAIL_SERVICE_URL}/send-notification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      subject,
      text: body,
      orderId: order._id,
      orderStatus: order.status,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Email service returned ${response.status}: ${errorText}`,
    );
  }
}

/**
 * Sends an SMS notification (placeholder for SMS provider integration).
 */
async function sendSmsNotification(
  order: OrderType,
  body: string,
): Promise<void> {
  if (!SMS_SERVICE_URL) {
    console.log("SMS service not configured, skipping SMS notification");
    return;
  }

  // TODO: Integrate with SMS provider (e.g., Twilio)
  // Example:
  // const response = await fetch(`${SMS_SERVICE_URL}/send`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     to: order.shippingAddress?.phone,
  //     message: body,
  //   }),
  // });

  console.log(`SMS notification queued for order ${order._id}: ${body}`);
}

/**
 * Sends a push notification (placeholder for push service integration).
 */
async function sendPushNotification(
  order: OrderType,
  title: string,
  body: string,
): Promise<void> {
  if (!PUSH_SERVICE_URL) {
    console.log("Push service not configured, skipping push notification");
    return;
  }

  // TODO: Integrate with push notification provider (e.g., Firebase Cloud Messaging)
  // Example:
  // const response = await fetch(`${PUSH_SERVICE_URL}/send`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     userId: order.userId,
  //     title,
  //     body,
  //     data: { orderId: order._id },
  //   }),
  // });

  console.log(`Push notification queued for order ${order._id}: ${title}`);
}

/**
 * Notification trigger definitions.
 * Maps trigger names to their notification configurations.
 */
const NOTIFICATION_TRIGGERS: Record<
  string,
  {
    email: boolean;
    sms: boolean;
    push: boolean;
    subject: (order: OrderType) => string;
    body: (order: OrderType) => string;
  }
> = {
  order_created: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Order #${order._id.slice(-6)} Received`,
    body: (order) =>
      `Your order has been received. Total: ${formatAmount(order.amount)}. We'll notify you when payment is confirmed.`,
  },
  payment_confirmed: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Payment Confirmed for Order #${order._id.slice(-6)}`,
    body: (order) =>
      `Your payment has been confirmed. We're preparing your order for shipment.`,
  },
  payment_failed: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Payment Unsuccessful for Order #${order._id.slice(-6)}`,
    body: (order) =>
      `Your payment wasn't successful. Please update your payment method to complete your order.`,
  },
  order_confirmed: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Order #${order._id.slice(-6)} Confirmed`,
    body: (order) =>
      `Your order has been confirmed. Estimated delivery: ${order.estimatedDeliveryDate ? formatDate(order.estimatedDeliveryDate) : "TBD"}.`,
  },
  order_shipped: {
    email: true,
    sms: true,
    push: true,
    subject: (order) => `Order #${order._id.slice(-6)} Shipped!`,
    body: (order) => {
      const shipment = order.shipments?.[order.shipments.length - 1];
      return `Your order is on its way! ${shipment?.trackingNumber ? `Tracking: ${shipment.trackingNumber} (${shipment.carrier})` : "Track your order in the app."}`;
    },
  },
  partially_shipped: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Part of Order #${order._id.slice(-6)} Shipped`,
    body: (order) =>
      `Part of your order has been shipped. The remaining items will follow shortly.`,
  },
  out_for_delivery: {
    email: false,
    sms: true,
    push: true,
    subject: (order) => `Order #${order._id.slice(-6)} Out for Delivery`,
    body: (order) =>
      `Your order is out for delivery today! Please be available to receive it.`,
  },
  delivered: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Order #${order._id.slice(-6)} Delivered`,
    body: (order) =>
      `Your order has been delivered. Thank you for shopping with us! How was your experience?`,
  },
  delivery_exception: {
    email: true,
    sms: true,
    push: true,
    subject: (order) => `Delivery Issue with Order #${order._id.slice(-6)}`,
    body: (order) =>
      `We encountered an issue delivering your order. Please check your order details for next steps.`,
  },
  refund_issued: {
    email: true,
    sms: false,
    push: false,
    subject: (order) => `Refund Processed for Order #${order._id.slice(-6)}`,
    body: (order) => {
      const refund = order.refunds?.[order.refunds.length - 1];
      return `A refund of ${refund?.amount ? formatAmount(refund.amount) : "TBD"} has been issued. ${refund?.reason ? `Reason: ${refund.reason}` : ""} Funds will appear in 5-10 business days.`;
    },
  },
  return_requested: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Return Requested for Order #${order._id.slice(-6)}`,
    body: (order) =>
      `Your return request has been received. We'll review it and get back to you shortly.`,
  },
  return_approved: {
    email: true,
    sms: false,
    push: true,
    subject: (order) => `Return Approved for Order #${order._id.slice(-6)}`,
    body: (order) =>
      `Your return has been approved. Please ship the item back using the provided return label.`,
  },
  auto_cancel_warning: {
    email: true,
    sms: false,
    push: false,
    subject: (order) => `Order #${order._id.slice(-6)} Will Be Cancelled`,
    body: (order) =>
      `Your order will be cancelled in 24 hours if payment isn't completed. Please complete your payment to avoid cancellation.`,
  },
};

/**
 * Dispatches notifications based on order status change.
 *
 * @param order - The updated order document
 * @param previousStatus - The status before the change
 * @param triggeredBy - Who triggered the change (system, user, admin)
 */
export async function dispatchNotifications(
  order: OrderType,
  previousStatus: OrderStatusType,
  triggeredBy: "system" | "user" | "admin" = "system",
): Promise<void> {
  const currentStatus = order.status as OrderStatusType;
  const triggerName = getTriggerFromTransition(previousStatus, currentStatus);

  if (!triggerName || !NOTIFICATION_TRIGGERS[triggerName]) {
    console.log(`No notification configured for transition: ${previousStatus} -> ${currentStatus}`);
    return;
  }

  const trigger = NOTIFICATION_TRIGGERS[triggerName];
  const userPrefs = order.notifications || {
    email: true,
    sms: false,
    push: true,
  };
 
  const notifications: Promise<void>[] = [];

  if (trigger.email && userPrefs.email) {
    notifications.push(
      sendNotification({
        order,
        trigger: triggerName,
        channel: "email",
        subject: trigger.subject(order),
        body: trigger.body(order),
      }),
    );
  }

  if (trigger.sms && userPrefs.sms) {
    notifications.push(
      sendNotification({
        order,
        trigger: triggerName,
        channel: "sms",
        subject: trigger.subject(order),
        body: trigger.body(order),
      }),
    );
  }

  if (trigger.push && userPrefs.push) {
    notifications.push(
      sendNotification({
        order,
        trigger: triggerName,
        channel: "push",
        subject: trigger.subject(order),
        body: trigger.body(order),
      }),
    );
  }

  await Promise.allSettled(notifications);
}

/**
 * Maps status transitions to notification trigger names.
 */
function getTriggerFromTransition(
  from: OrderStatusType,
  to: OrderStatusType,
): string | null {
  const transitionMap: Record<string, string> = {
    "pending->payment_pending": "order_created",
    "payment_pending->payment_processing": "order_created",
    "payment_processing->payment_confirmed": "payment_confirmed",
    "payment_processing->payment_failed": "payment_failed",
    "payment_confirmed->confirmed": "order_confirmed",
    "processing->shipped": "order_shipped",
    "processing->partially_shipped": "partially_shipped",
    "partially_shipped->shipped": "order_shipped",
    "shipped->out_for_delivery": "out_for_delivery",
    "out_for_delivery->delivered": "delivered",
    "shipped->delivery_exception": "delivery_exception",
    "out_for_delivery->delivery_exception": "delivery_exception",
    "delivered->return_requested": "return_requested",
    "return_requested->return_in_progress": "return_approved",
  };

  return transitionMap[`${from}->${to}`] || null;
}

/**
 * Formats amount from cents to currency string.
 */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency: "TZS",
    minimumFractionDigits: 0,
  }).format(amount / 100);
}

/**
 * Formats date to human-readable string.
 */
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
