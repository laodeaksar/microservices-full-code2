/*import { Hono } from "hono";
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
    case "checkout.session.completed":
      const session = event.data.object as Stripe.Checkout.Session;

      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
      );

      // Create order via direct HTTP call to order service
      const orderData = {
        userId: session.client_reference_id,
        email: session.customer_details?.email,
        amount: session.amount_total,
        status: session.payment_status === "paid" ? "success" : "failed",
        products: lineItems.data.map((item) => ({
          name: item.description,
          quantity: item.quantity,
          price: item.price?.unit_amount,
        })),
      };

      try {
        const ORDER_SERVICE_URL =
          process.env.ORDER_SERVICE_URL || "http://localhost:8001";
        await fetch(`${ORDER_SERVICE_URL}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderData),
        });
        console.log("Order created successfully");
      } catch (error) {
        console.error("Failed to create order:", error);
      }

      break;

    default:
      break;
  }
  return c.json({ received: true });
});

export default webhookRoute;*/

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
