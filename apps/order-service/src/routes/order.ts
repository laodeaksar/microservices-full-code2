import { FastifyInstance } from "fastify";
import { shouldBeAdmin, shouldBeUser } from "../middleware/authMiddleware";
import { Order } from "@repo/order-db";
import {
  startOfMonth,
  subMonths,
  subDays,
  format,
  startOfDay,
  endOfDay,
} from "date-fns";
import {
  OrderChartType,
  OrderStatusDistribution,
  DailyOrderTrend,
  DashboardStats,
} from "@repo/types";
import { createOrder } from "../utils/order";
import {
  validateTransition,
  InvalidTransitionError,
  getStatusLabel,
} from "../utils/stateMachine";
import {
  recordStatusChange,
  getStatusHistory,
} from "../utils/auditLogger";
import { OrderStatusType, StatusChangeRequest } from "@repo/types";
import { dispatchNotifications } from "../utils/notifications";

export const orderRoute = async (fastify: FastifyInstance) => {
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
              //@ts-ignore
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

  // Get single order by ID
  fastify.get(
    "/orders/:id",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const order = await Order.findById(id);
        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
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
          //@ts-ignore
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

  // Get order tracking information
  fastify.get(
    "/orders/:id/tracking",
    { preHandler: shouldBeUser },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const order = await Order.findById(id).select(
          "shipments status estimatedDeliveryDate actualDeliveryDate userId",
        );

        if (!order) {
          return reply.status(404).send({
            error: "Order not found",
            orderId: id,
          });
        }

        // Verify user owns this order
        if (order.userId !== request.userId) {
          return reply.status(403).send({
            error: "Unauthorized",
            message: "You can only view your own orders",
          });
        }

        return reply.send({
          status: order.status,
          label: getStatusLabel(order.status as OrderStatusType),
          shipments: order.shipments,
          estimatedDeliveryDate: order.estimatedDeliveryDate,
          actualDeliveryDate: order.actualDeliveryDate,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to fetch tracking info",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Get order status history
  fastify.get(
    "/orders/:id/history",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const history = await getStatusHistory(id);
        return reply.send({ history });
      } catch (error) {
        return reply.status(500).send({
          error: "Failed to fetch order history",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

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

  fastify.get(
    "/user-orders",
    { preHandler: shouldBeUser },
    async (request, reply) => {
      const orders = await Order.find({ userId: request.userId });
      return reply.send(orders);
    },
  );
  fastify.get(
    "/orders",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      const { limit } = request.query as { limit?: string | number };
      const parsedLimit = Number(limit);
      const safeLimit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 200)
        : 50;

      const orders = await Order.find()
        .limit(safeLimit)
        .sort({ createdAt: -1 });
      return reply.send(orders);
    },
  );

  // Dashboard stats endpoint
  fastify.get(
    "/dashboard-stats",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      const now = new Date();
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);

      const [totalStats, todayStats] = await Promise.all([
        Order.aggregate([
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalRevenue: { $sum: "$amount" },
              successfulOrders: {
                $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
              },
            },
          },
        ]),
        Order.aggregate([
          {
            $match: {
              createdAt: { $gte: todayStart, $lte: todayEnd },
            },
          },
          {
            $group: {
              _id: null,
              ordersToday: { $sum: 1 },
              revenueToday: { $sum: "$amount" },
            },
          },
        ]),
      ]);

      const total = totalStats[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        successfulOrders: 0,
      };
      const today = todayStats[0] || { ordersToday: 0, revenueToday: 0 };

      const stats: DashboardStats = {
        totalOrders: total.totalOrders,
        totalRevenue: total.totalRevenue / 100, // Convert from cents
        successRate:
          total.totalOrders > 0
            ? Math.round((total.successfulOrders / total.totalOrders) * 100)
            : 0,
        averageOrderValue:
          total.totalOrders > 0
            ? Math.round(total.totalRevenue / total.totalOrders / 100)
            : 0,
        ordersToday: today.ordersToday,
        revenueToday: today.revenueToday / 100,
      };

      return reply.send(stats);
    },
  );

  // Order status distribution for pie chart
  fastify.get(
    "/order-status-distribution",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      const statusColors: Record<string, string> = {
        success: "var(--chart-4)",
        failed: "var(--chart-1)",
        pending: "var(--chart-3)",
        cancelled: "var(--chart-2)",
      };

      const raw = await Order.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const results: OrderStatusDistribution[] = raw.map((item) => ({
        status: item._id,
        count: item.count,
        fill: statusColors[item._id] || "var(--chart-5)",
      }));

      return reply.send(results);
    },
  );

  // Daily order trends for area chart (last 30 days)
  fastify.get(
    "/daily-order-trends",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 29);

      const raw = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfDay(thirtyDaysAgo), $lte: now },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            orders: { $sum: 1 },
            revenue: { $sum: "$amount" },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]);

      // Fill in all 30 days, even if no orders
      const results: DailyOrderTrend[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = subDays(now, i);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();

        const match = raw.find(
          (item) =>
            item._id.year === year &&
            item._id.month === month &&
            item._id.day === day,
        );

        results.push({
          date: format(d, "MMM dd"),
          orders: match ? match.orders : 0,
          revenue: match ? Math.round(match.revenue / 100) : 0, // Convert from cents
        });
      }

      return reply.send(results);
    },
  );

  fastify.get(
    "/order-chart",
    { preHandler: shouldBeAdmin },
    async (request, reply) => {
      const now = new Date();
      const sixMonthsAgo = startOfMonth(subMonths(now, 5));

      // { month: "April", total: 173, successful: 100 }

      const raw = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: sixMonthsAgo, $lte: now },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            total: { $sum: 1 },
            successful: {
              $sum: {
                $cond: [{ $eq: ["$status", "success"] }, 1, 0],
                // {
                //   "year":2025,
                //   "month":9,
                //   "total":100,
                //   "successful":72
                // }
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            year: "$_id.year",
            month: "$_id.month",
            total: 1,
            successful: 1,
          },
        },
        {
          $sort: { year: 1, month: 1 },
        },
      ]);

      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      const results: OrderChartType[] = [];

      for (let i = 5; i >= 0; i--) {
        const d = subMonths(now, i);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;

        const match = raw.find(
          (item) => item.year === year && item.month === month,
        );

        results.push({
          month: monthNames[month - 1] as string,
          total: match ? match.total : 0,
          successful: match ? match.successful : 0,
        });
      }

      return reply.send(results);
    },
  );
};
