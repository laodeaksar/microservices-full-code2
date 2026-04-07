import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Order } from "@repo/order-db";
import {
  validateTransition,
  InvalidTransitionError,
} from "../utils/stateMachine";
import { OrderStatusType, StatusChangeRequest } from "@repo/types";

/**
 * Fastify plugin for status transition validation.
 */
export const statusValidationPlugin = async (fastify: FastifyInstance) => {
  /**
   * Validates that the requested status transition is allowed.
   *
   * This middleware:
   * 1. Fetches the current order
   * 2. Validates the transition from current to new status
   * 3. Attaches the order and validated status to the request
   */
  fastify.addHook(
    "preHandler",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: StatusChangeRequest;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { status: newStatus, reason, changedBy } = request.body;

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

        // Attach validated data to request for downstream handlers
        (request as any).currentOrder = order;
        (request as any).validatedStatus = newStatus;
        (request as any).transitionReason = reason;
        (request as any).changedBy = changedBy || "system";
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return reply.status(400).send({
            error: "Invalid status transition",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
};
