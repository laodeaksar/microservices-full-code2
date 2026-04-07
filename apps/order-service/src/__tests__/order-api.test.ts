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
