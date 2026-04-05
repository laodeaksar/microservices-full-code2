# Phase 2 Implementation Guide: API & Notifications

**Goal:** Build new API endpoints and notification system for the order status flow redesign.

**Prerequisites:** Phase 1 must be fully completed, including:
- Extended OrderSchema with all new fields
- Updated TypeScript types in `@repo/types`
- State machine service (`stateMachine.ts`)
- Audit logging utility (`auditLogger.ts`)
- Status transition validation middleware
- Database migration script executed

---

## Step 1: Build Notification Service

**File:** `apps/order-service/src/utils/notifications.ts` (NEW FILE)

### 1.1 Create the notification service

This service centralizes all notification dispatch logic, routing to email, SMS, and push channels based on user preferences and trigger type.

```typescript
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
```

### 1.2 Required Dependencies

No new external dependencies. Uses existing `fetch` API for HTTP calls.

### 1.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 2: Extend Email Service with New Templates

**File:** [`apps/email-service/src/index.ts`](apps/email-service/src/index.ts)

### 2.1 Add new notification endpoint

Add a new endpoint that handles all notification types with rich HTML templates.

Add this endpoint before the `app.listen()` call:

```typescript
// Send notification email endpoint (unified)
app.post("/send-notification", async (req, res) => {
  try {
    const { email, subject, text, orderId, orderStatus } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    await sendMail({
      email,
      subject,
      text,
      html: generateNotificationHtml(orderId, orderStatus, text),
    });

    res.json({ success: true, message: "Notification email sent" });
  } catch (error) {
    console.error("Failed to send notification email:", error);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
});
```

### 2.2 Add HTML template generator

Add this helper function to generate rich HTML emails:

```typescript
/**
 * Generates HTML content for notification emails.
 */
function generateNotificationHtml(
  orderId?: string,
  orderStatus?: string,
  text?: string,
): string {
  const statusColors: Record<string, string> = {
    pending: "#f59e0b",
    payment_confirmed: "#10b981",
    payment_failed: "#ef4444",
    confirmed: "#10b981",
    processing: "#3b82f6",
    shipped: "#8b5cf6",
    out_for_delivery: "#f97316",
    delivered: "#10b981",
    delivery_exception: "#ef4444",
    cancelled: "#6b7280",
    refunded: "#6b7280",
    return_requested: "#f59e0b",
    return_approved: "#10b981",
  };

  const status = orderStatus || "update";
  const color = statusColors[orderStatus] || "#3b82f6";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order ${status}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 20px 0;">
            <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <tr>
                <td style="background-color: ${color}; padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Order ${status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  ${orderId ? `<p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">Order #${orderId.slice(-6)}</p>` : ""}
                  <p style="margin: 0 0 20px 0; color: #111827; font-size: 16px; line-height: 1.5;">${text || "Your order status has been updated."}</p>
                  <table role="presentation" style="border-collapse: collapse; width: 100%;">
                    <tr>
                      <td style="padding: 15px; background-color: #f9fafb; border-radius: 6px; text-align: center;">
                        <span style="display: inline-block; padding: 8px 16px; background-color: ${color}; color: #ffffff; border-radius: 4px; font-size: 14px; font-weight: 500;">${status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px 30px; background-color: #f9fafb; text-align: center;">
                  <p style="margin: 0; color: #6b7280; font-size: 12px;">Need help? Contact our support team.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}
```

### 2.3 Update mailer utility to support HTML

**File:** [`apps/email-service/src/utils/mailer.ts`](apps/email-service/src/utils/mailer.ts)

Update the `sendMail` function to accept an optional `html` parameter:

```typescript
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    type: "OAuth2",
    user: "akhsarodhe@gmail.com",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  },
});

const sendMail = async ({
  email,
  subject,
  text,
  html,
}: {
  email: string;
  subject: string;
  text: string;
  html?: string;
}) => {
  const res = await transporter.sendMail({
    from: '"Aksar La\'ode" <akhsarodhe@gmail.com>',
    to: email,
    subject,
    text,
    html,
  });

  console.log("MESSAGE SENT:", res);
};

export default sendMail;
```

### 2.4 Required Dependencies

No new dependencies. Uses existing `nodemailer`.

### 2.5 Build and Test

```bash
cd apps/email-service && pnpm tsc --noEmit
```

---

## Step 3: Add PATCH /orders/:id/status Endpoint with Full Integration

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

### 3.1 Update the PATCH endpoint to dispatch notifications

The PATCH endpoint from Phase 1 needs to be updated to dispatch notifications after a successful status change.

Find the existing `PATCH /orders/:id/status` handler and update the success response section:

```typescript
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

        // Store previous status for notification dispatch
        const previousStatus = order.status as OrderStatusType;

        // Record the status change (includes audit logging)
        const updatedOrder = await recordStatusChange(id, {
          from: previousStatus,
          to: newStatus,
          reason,
          changedBy: changedBy || "admin",
          changedAt: new Date(),
        });

        // Dispatch notifications (non-blocking)
        dispatchNotifications(
          updatedOrder.toObject(),
          previousStatus,
          changedBy || "admin",
        ).catch((err) =>
          console.error("Notification dispatch failed:", err),
        );

        return reply.send({
          success: true,
          order: updatedOrder,
          previousStatus,
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
```

### 3.2 Add required imports

Add the `dispatchNotifications` import at the top of the file:

```typescript
import { dispatchNotifications } from "../utils/notifications";
```

### 3.3 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 4: Update Payment Webhook Integration

**File:** [`apps/payment-service/src/routes/webhooks.route.ts`](apps/payment-service/src/routes/webhooks.route.ts)

### 4.1 Update webhook to use new status flow

The current webhook creates orders with `success`/`failed` status. Update it to use the new multi-state flow:

1. Create order with `pending` status when checkout session is created
2. Update to `payment_confirmed` when payment succeeds
3. Update to `payment_failed` when payment fails

Replace the entire webhook handler:

```typescript
import { Hono } from "hono";
import Stripe from "stripe";
import stripe from "../utils/stripe";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || "http://localhost:8001";
const webhookRoute = new Hono();

webhookRoute.get("/", (c) => {
  return c.json({
    status: "ok webhook",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

webhookRoute.post("/stripe", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig!, webhookSecret);
  } catch (error) {
    console.log("Webhook verification failed!");
    return c.json({ error: "Webhook verification failed!" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
      );

      // Create order with payment_confirmed status
      const orderData = {
        userId: session.client_reference_id,
        email: session.customer_details?.email,
        amount: session.amount_total,
        status: "payment_confirmed",
        paymentIntentId: session.payment_intent,
        paymentMethod: session.payment_method_types?.[0],
        paymentCompletedAt: new Date(),
        products: lineItems.data.map((item) => ({
          name: item.description || "Unknown Product",
          quantity: item.quantity || 1,
          price: item.price?.unit_amount,
          status: "pending",
        })),
      };

      try {
        await fetch(`${ORDER_SERVICE_URL}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderData),
        });
        console.log("Order created with payment_confirmed status");
      } catch (error) {
        console.error("Failed to create order:", error);
      }

      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Update order to payment_failed if it exists
      try {
        const orderResponse = await fetch(
          `${ORDER_SERVICE_URL}/orders/by-payment-intent/${session.payment_intent}`,
          {
            method: "GET",
          },
        );

        if (orderResponse.ok) {
          const order = await orderResponse.json();
          await fetch(`${ORDER_SERVICE_URL}/orders/${order._id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "payment_failed",
              reason: "Checkout session expired",
              changedBy: "system",
            }),
          });
        }
      } catch (error) {
        console.error("Failed to update expired order:", error);
      }

      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      // Update order to payment_failed
      try {
        const orderResponse = await fetch(
          `${ORDER_SERVICE_URL}/orders/by-payment-intent/${paymentIntent.id}`,
          {
            method: "GET",
          },
        );

        if (orderResponse.ok) {
          const order = await orderResponse.json();
          await fetch(`${ORDER_SERVICE_URL}/orders/${order._id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "payment_failed",
              reason: paymentIntent.last_payment_error?.message || "Payment declined",
              changedBy: "system",
            }),
          });
        }
      } catch (error) {
        console.error("Failed to update failed payment order:", error);
      }

      break;
    }

    default:
      break;
  }

  return c.json({ received: true });
});

export default webhookRoute;
```

### 4.2 Required Dependencies

No new dependencies. Uses existing `stripe` and `hono`.

### 4.3 Build and Test

```bash
cd apps/payment-service && pnpm tsc --noEmit
```

---

## Step 5: Add GET /orders/by-payment-intent/:paymentIntentId Endpoint

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

### 5.1 Add the lookup endpoint

This endpoint allows payment-service to find an order by its Stripe Payment Intent ID for status updates.

Add this route handler:

```typescript
  // Find order by payment intent ID (used by payment-service webhook)
  fastify.get(
    "/orders/by-payment-intent/:paymentIntentId",
    async (request, reply) => {
      try {
        const { paymentIntentId } = request.params as {
          paymentIntentId: string;
        };
        const order = await Order.findOne({ paymentIntentId });
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            paymentIntentId,
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
```

### 5.2 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 6: Add Carrier Tracking Webhook Endpoint

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

### 6.1 Add the tracking webhook

This endpoint receives tracking updates from carriers or tracking aggregation services.

```typescript
  // Carrier tracking webhook endpoint
  fastify.post(
    "/orders/tracking-webhook",
    async (request, reply) => {
      try {
        const body = request.body as {
          trackingNumber: string;
          carrier: string;
          status: string;
          deliveredAt?: string;
          estimatedDeliveryDate?: string;
        };

        const { trackingNumber, carrier, status, deliveredAt, estimatedDeliveryDate } = body;

        // Find order by tracking number
        const order = await Order.findOne({
          "shipments.trackingNumber": trackingNumber,
        });

        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            trackingNumber,
          });
        }

        const previousStatus = order.status as OrderStatusType;

        // Update the shipment status
        const shipment = order.shipments.find(
          (s: any) => s.trackingNumber === trackingNumber,
        );

        if (shipment) {
          shipment.status = status;
          if (deliveredAt) {
            shipment.deliveredAt = new Date(deliveredAt);
          }
        }

        // Map carrier status to our order status
        const statusMapping: Record<string, OrderStatusType> = {
          "in_transit": "shipped",
          "out_for_delivery": "out_for_delivery",
          "delivered": "delivered",
          "exception": "delivery_exception",
          "returned": "return_requested",
        };

        const newOrderStatus = statusMapping[status];

        if (newOrderStatus && newOrderStatus !== previousStatus) {
          // Validate and record the transition
          try {
            validateTransition(previousStatus, newOrderStatus);

            order.status = newOrderStatus;

            if (newOrderStatus === "delivered") {
              order.actualDeliveryDate = deliveredAt
                ? new Date(deliveredAt)
                : new Date();
            }

            order.statusHistory.push({
              from: previousStatus,
              to: newOrderStatus,
              reason: `Carrier update: ${status}`,
              changedBy: "system",
              changedAt: new Date(),
            });

            await order.save();

            // Dispatch notifications
            dispatchNotifications(
              order.toObject(),
              previousStatus,
              "system",
            ).catch((err) =>
              console.error("Notification dispatch failed:", err),
            );
          } catch (error) {
            if (error instanceof InvalidTransitionError) {
              console.log(
                `Skipping invalid transition: ${previousStatus} -> ${newOrderStatus}`,
              );
            } else {
              throw error;
            }
          }
        } else {
          // Just save shipment update without status change
          await order.save();
        }

        return reply.send({
          success: true,
          orderId: order._id,
          trackingNumber,
          status,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to process tracking update",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
```

### 6.2 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 7: Add Auto-Cancel Job for Unpaid Orders

**File:** `apps/order-service/src/utils/autoCancel.ts` (NEW FILE)

### 7.1 Create the auto-cancel utility

This utility provides functions to find and cancel orders that have been in `payment_pending` state for too long.

```typescript
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
```

### 7.2 Add scheduled job to index.ts

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

Add the auto-cancel job scheduler:

```typescript
import { processExpiredPendingOrders } from "./utils/autoCancel";

// ... existing code ...

const start = async () => {
  try {
    console.log("Starting order service...");

    // Log outgoing IP for MongoDB whitelist setup
    try {
      const ipResponse = await fetch("https://api.ipify.org?format=json");
      const ipData = (await ipResponse.json()) as { ip: string };
      console.log(`🌐 Outgoing IP Address: ${ipData.ip}`);
      console.log(
        `   ⚠️  Add this IP to MongoDB Atlas Network Access if connection fails`,
      );
    } catch (ipErr) {
      console.log("Could not fetch outgoing IP (non-critical)");
    }

    await connectOrderDB();
    console.log("Database connection established");

    // Start auto-cancel job (runs every 5 minutes)
    const AUTO_CANCEL_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const PAYMENT_TIMEOUT_MINUTES = 30;

    setInterval(async () => {
      try {
        const cancelled = await processExpiredPendingOrders(
          PAYMENT_TIMEOUT_MINUTES,
        );
        if (cancelled > 0) {
          console.log(
            `Auto-cancelled ${cancelled} expired pending orders`,
          );
        }
      } catch (error) {
        console.error("Auto-cancel job failed:", error);
      }
    }, AUTO_CANCEL_INTERVAL);

    console.log(
      `Auto-cancel job started (checking every ${AUTO_CANCEL_INTERVAL / 1000}s, timeout: ${PAYMENT_TIMEOUT_MINUTES}m)`,
    );

    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Order service is running on port ${PORT}`);
  } catch (err) {
    console.error("Failed to start order service:", err);
    process.exit(1);
  }
};
start();
```

### 7.3 Required Dependencies

No new external dependencies. Uses native `setInterval` for scheduling.

### 7.4 Build and Test

```bash
cd apps/order-service && pnpm tsc --noEmit
```

---

## Step 8: Write Integration Tests for API Endpoints

**File:** `apps/order-service/src/__tests__/order-api.test.ts` (NEW FILE)

### 8.1 Create the integration test file

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import mongoose from "mongoose";
import { Order, connectOrderDB } from "@repo/order-db";
import { orderRoute } from "../routes/order";

// Mock auth middleware
vi.mock("../middleware/authMiddleware", () => ({
  shouldBeAdmin: async (request: any, reply: any) => {},
  shouldBeUser: async (request: any, reply: any) => {
    request.userId = "test-user-123";
  },
}));

describe("Order API Integration Tests", () => {
  let app: Fastify.FastifyInstance;
  let testOrderId: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(orderRoute);
    await connectOrderDB();
  });

  afterAll(async () => {
    await app.close();
    await mongoose.connection.close();
  });

  describe("POST /orders", () => {
    it("should create an order with pending status", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/orders",
        payload: {
          userId: "test-user-123",
          email: "test@example.com",
          amount: 10000,
          status: "pending",
          products: [
            { name: "Test Product", quantity: 1, price: 10000 },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("pending");
      expect(body._id).toBeDefined();
      testOrderId = body._id;
    });
  });

  describe("GET /orders/:id", () => {
    it("should return order by ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/orders/${testOrderId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body._id).toBe(testOrderId);
    });

    it("should return 404 for non-existent order", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/orders/non-existent-id",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH /orders/:id/status", () => {
    it("should allow valid transition pending -> payment_pending", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/orders/${testOrderId}/status`,
        payload: {
          status: "payment_pending",
          reason: "User initiated checkout",
          changedBy: "user",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.newStatus).toBe("payment_pending");
    });

    it("should reject invalid transition payment_pending -> delivered", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/orders/${testOrderId}/status`,
        payload: {
          status: "delivered",
          reason: "Invalid jump",
          changedBy: "admin",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Invalid status transition");
    });

    it("should allow payment_pending -> payment_processing -> payment_confirmed", async () => {
      // payment_pending -> payment_processing
      let response = await app.inject({
        method: "PATCH",
        url: `/orders/${testOrderId}/status`,
        payload: {
          status: "payment_processing",
          reason: "Payment submitted",
          changedBy: "system",
        },
      });
      expect(response.statusCode).toBe(200);

      // payment_processing -> payment_confirmed
      response = await app.inject({
        method: "PATCH",
        url: `/orders/${testOrderId}/status`,
        payload: {
          status: "payment_confirmed",
          reason: "Payment verified",
          changedBy: "system",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.newStatus).toBe("payment_confirmed");
    });
  });

  describe("GET /orders/:id/tracking", () => {
    it("should return tracking info for order", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/orders/${testOrderId}/tracking`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
      expect(body.shipments).toBeDefined();
    });
  });

  describe("GET /orders/:id/history", () => {
    it("should return status history for order", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/orders/${testOrderId}/history`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.history).toBeDefined();
      expect(Array.isArray(body.history)).toBe(true);
      expect(body.history.length).toBeGreaterThan(0);
    });
  });

  describe("GET /orders/by-payment-intent/:paymentIntentId", () => {
    it("should return 404 when no order found", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/orders/by-payment-intent/pi_nonexistent",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
```

### 8.2 Required Dependencies

Ensure `vitest` is installed:

```bash
cd apps/order-service && pnpm add -D vitest
```

### 8.3 Add test script to package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run src/__tests__/order-api.test.ts"
  }
}
```

### 8.4 Run the tests

```bash
cd apps/order-service && pnpm test:integration
```

---

## Step 9: Write Unit Tests for Notification Service

**File:** `apps/order-service/src/utils/__tests__/notifications.test.ts` (NEW FILE)

### 9.1 Create the notification test file

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchNotifications } from "../notifications";
import { OrderType, OrderStatusType } from "@repo/types";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Notification Service", () => {
  const mockOrder: OrderType = {
    _id: "order-123",
    userId: "user-123",
    email: "test@example.com",
    amount: 10000,
    status: "payment_confirmed",
    products: [{ name: "Test", quantity: 1, price: 10000 }],
    notifications: {
      email: true,
      sms: false,
      push: true,
    },
    shipments: [],
    refunds: [],
    statusHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
    });
  });

  describe("dispatchNotifications", () => {
    it("should send email notification for payment_confirmed", async () => {
      await dispatchNotifications(mockOrder, "payment_processing", "system");

      // Should have called fetch for email notification
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should not send notifications when user has disabled all channels", async () => {
      const orderWithNoPrefs = {
        ...mockOrder,
        notifications: { email: false, sms: false, push: false },
      };

      await dispatchNotifications(
        orderWithNoPrefs,
        "payment_processing",
        "system",
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not send notification for unconfigured transition", async () => {
      await dispatchNotifications(mockOrder, "cancelled", "system");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should handle email service failure gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Email service down"));

      await expect(
        dispatchNotifications(mockOrder, "payment_processing", "system"),
      ).resolves.not.toThrow();
    });
  });
});
```

### 9.2 Run the tests

```bash
cd apps/order-service && pnpm test
```

---

## Step 10: Error Handling and Edge Cases

### 10.1 Global Error Handler

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

Add a global error handler for unhandled promise rejections:

```typescript
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Graceful shutdown
  process.exit(1);
});
```

### 10.2 Idempotency for Order Creation

Add idempotency key support to order creation:

**File:** [`apps/order-service/src/routes/order.ts`](apps/order-service/src/routes/order.ts)

Update the POST `/orders` handler:

```typescript
  // Internal order creation endpoint (used by payment-service webhook).
  fastify.post("/orders", async (request, reply) => {
    try {
      const body = request.body as any;
      const idempotencyKey = body.idempotencyKey;

      // Check for duplicate request
      if (idempotencyKey) {
        const existingOrder = await Order.findOne({ idempotencyKey });
        if (existingOrder) {
          return reply.status(200).send(existingOrder);
        }
      }

      const order = await createOrder(body);

      // Store idempotency key
      if (idempotencyKey) {
        order.idempotencyKey = idempotencyKey;
        await order.save();
      }

      return reply.status(201).send(order);
    } catch (error) {
      return reply.status(400).send({
        error: "Failed to create order",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
```

Add `idempotencyKey` to the schema in [`packages/order-db/src/order-model.ts`](packages/order-db/src/order-model.ts):

```typescript
// Add to schema
idempotencyKey: { type: String, unique: true, sparse: true },
```

### 10.3 Rate Limiting for Status Updates

Add rate limiting to prevent abuse:

```bash
cd apps/order-service && pnpm add @fastify/rate-limit
```

**File:** [`apps/order-service/src/index.ts`](apps/order-service/src/index.ts)

```typescript
import FastifyRateLimit from "@fastify/rate-limit";

fastify.register(FastifyRateLimit, {
  max: 100,
  timeWindow: "1 minute",
});
```

---

## Summary of Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `apps/order-service/src/utils/notifications.ts` | Created | Centralized notification service with multi-channel support |
| `apps/order-service/src/utils/autoCancel.ts` | Created | Auto-cancel job for expired pending orders |
| `apps/order-service/src/routes/order.ts` | Modified | Added PATCH with notifications, tracking webhook, payment-intent lookup |
| `apps/order-service/src/index.ts` | Modified | Added auto-cancel scheduler, error handlers |
| `apps/order-service/src/utils/__tests__/notifications.test.ts` | Created | Unit tests for notification service |
| `apps/order-service/src/__tests__/order-api.test.ts` | Created | Integration tests for API endpoints |
| `apps/email-service/src/index.ts` | Modified | Added unified notification endpoint with HTML templates |
| `apps/email-service/src/utils/mailer.ts` | Modified | Added HTML email support |
| `apps/payment-service/src/routes/webhooks.route.ts` | Modified | Updated to use new multi-state order flow |

---

## Next Steps

After completing Phase 2, proceed to Phase 3: Client UI (Weeks 5-8) as defined in the main redesign plan.
