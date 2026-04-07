import { describe, it, expect } from "vitest";
import {
  validateTransition,
  getValidNextStatuses,
  isTerminalStatus,
  getStatusCategory,
  getStatusLabel,
  InvalidTransitionError,
  VALID_TRANSITIONS,
  STATUS_CATEGORIES,
  STATUS_LABELS,
} from "../stateMachine";
import { OrderStatusType } from "@repo/types";

describe("State Machine", () => {
  describe("validateTransition", () => {
    it("should allow valid transitions", () => {
      expect(validateTransition("pending", "payment_pending")).toBe(true);
      expect(validateTransition("pending", "cancelled")).toBe(true);
      expect(validateTransition("payment_pending", "payment_processing")).toBe(true);
      expect(validateTransition("payment_processing", "payment_confirmed")).toBe(true);
      expect(validateTransition("payment_processing", "payment_failed")).toBe(true);
      expect(validateTransition("payment_confirmed", "confirmed")).toBe(true);
      expect(validateTransition("confirmed", "processing")).toBe(true);
      expect(validateTransition("processing", "shipped")).toBe(true);
      expect(validateTransition("shipped", "delivered")).toBe(false); // shipped -> out_for_delivery -> delivered
      expect(validateTransition("shipped", "out_for_delivery")).toBe(true);
      expect(validateTransition("out_for_delivery", "delivered")).toBe(true);
    });

    it("should throw InvalidTransitionError for invalid transitions", () => {
      expect(() => validateTransition("pending", "shipped")).toThrow(
        InvalidTransitionError,
      );
      expect(() => validateTransition("cancelled", "pending")).toThrow(
        InvalidTransitionError,
      );
      expect(() => validateTransition("delivered", "processing")).toThrow(
        InvalidTransitionError,
      );
      expect(() => validateTransition("refunded", "pending")).toThrow(
        InvalidTransitionError,
      );
    });

    it("should prevent transitions from terminal states", () => {
      const terminalStates: OrderStatusType[] = [
        "cancelled",
        "refunded",
        "partially_refunded",
        "return_completed",
      ];

      terminalStates.forEach((state) => {
        expect(() => validateTransition(state, "pending")).toThrow(
          InvalidTransitionError,
        );
      });
    });

    it("should allow retry from payment_failed", () => {
      expect(validateTransition("payment_failed", "payment_pending")).toBe(true);
      expect(validateTransition("payment_failed", "cancelled")).toBe(true);
    });

    it("should allow delivery exception recovery", () => {
      expect(
        validateTransition("delivery_exception", "out_for_delivery"),
      ).toBe(true);
      expect(validateTransition("delivery_exception", "refunded")).toBe(true);
    });
  });

  describe("getValidNextStatuses", () => {
    it("should return valid next statuses for pending", () => {
      const nextStatuses = getValidNextStatuses("pending");
      expect(nextStatuses).toContain("payment_pending");
      expect(nextStatuses).toContain("cancelled");
      expect(nextStatuses).toHaveLength(2);
    });

    it("should return valid next statuses for processing", () => {
      const nextStatuses = getValidNextStatuses("processing");
      expect(nextStatuses).toContain("partially_shipped");
      expect(nextStatuses).toContain("shipped");
      expect(nextStatuses).toContain("cancelled");
      expect(nextStatuses).toContain("refunded");
      expect(nextStatuses).toHaveLength(4);
    });

    it("should return empty array for terminal states", () => {
      expect(getValidNextStatuses("cancelled")).toEqual([]);
      expect(getValidNextStatuses("refunded")).toEqual([]);
      expect(getValidNextStatuses("partially_refunded")).toEqual([]);
    });
  });

  describe("isTerminalStatus", () => {
    it("should identify terminal states", () => {
      expect(isTerminalStatus("cancelled")).toBe(true);
      expect(isTerminalStatus("refunded")).toBe(true);
      expect(isTerminalStatus("partially_refunded")).toBe(true);
      expect(isTerminalStatus("return_completed")).toBe(true);
    });

    it("should identify non-terminal states", () => {
      expect(isTerminalStatus("pending")).toBe(false);
      expect(isTerminalStatus("processing")).toBe(false);
      expect(isTerminalStatus("shipped")).toBe(false);
      expect(isTerminalStatus("delivered")).toBe(false); // delivered can transition to returns
    });
  });

  describe("getStatusCategory", () => {
    it("should return correct category for pre_payment statuses", () => {
      expect(getStatusCategory("pending")).toBe("pre_payment");
      expect(getStatusCategory("payment_pending")).toBe("pre_payment");
    });

    it("should return correct category for payment statuses", () => {
      expect(getStatusCategory("payment_processing")).toBe("payment");
      expect(getStatusCategory("payment_confirmed")).toBe("payment");
      expect(getStatusCategory("payment_failed")).toBe("payment");
    });

    it("should return correct category for fulfillment statuses", () => {
      expect(getStatusCategory("partially_shipped")).toBe("fulfillment");
      expect(getStatusCategory("shipped")).toBe("fulfillment");
      expect(getStatusCategory("out_for_delivery")).toBe("fulfillment");
    });

    it("should return correct category for terminal statuses", () => {
      expect(getStatusCategory("cancelled")).toBe("terminal");
      expect(getStatusCategory("refunded")).toBe("terminal");
      expect(getStatusCategory("return_completed")).toBe("terminal");
    });
  });

  describe("getStatusLabel", () => {
    it("should return user-friendly labels", () => {
      expect(getStatusLabel("pending")).toBe("Awaiting Payment");
      expect(getStatusLabel("payment_confirmed")).toBe("Payment Confirmed");
      expect(getStatusLabel("shipped")).toBe("Shipped");
      expect(getStatusLabel("delivered")).toBe("Delivered");
      expect(getStatusLabel("delivery_exception")).toBe("Delivery Issue");
    });
  });

  describe("InvalidTransitionError", () => {
    it("should have correct error name and message", () => {
      const error = new InvalidTransitionError("pending", "shipped");
      expect(error.name).toBe("InvalidTransitionError");
      expect(error.message).toBe('Invalid transition from "pending" to "shipped"');
      expect(error.from).toBe("pending");
      expect(error.to).toBe("shipped");
    });

    it("should accept custom message", () => {
      const error = new InvalidTransitionError(
        "pending",
        "shipped",
        "Custom error message",
      );
      expect(error.message).toBe("Custom error message");
    });
  });

  describe("VALID_TRANSITIONS completeness", () => {
    it("should have entries for all OrderStatusType values", () => {
      const allStatuses: OrderStatusType[] = [
        "pending",
        "payment_pending",
        "payment_processing",
        "payment_confirmed",
        "payment_failed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refunded",
        "partially_refunded",
        "delivery_exception",
        "return_requested",
        "return_in_progress",
        "return_completed",
      ];

      allStatuses.forEach((status) => {
        expect(VALID_TRANSITIONS[status]).toBeDefined();
      });
    });
  });
  
describe("STATUS_CATEGORIES completeness", () => {
    it("should have categories for all OrderStatusType values", () => {
      const allStatuses: OrderStatusType[] = [
        "pending",
        "payment_pending",
        "payment_processing",
        "payment_confirmed",
        "payment_failed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refunded",
        "partially_refunded",
        "delivery_exception",
        "return_requested",
        "return_in_progress",
        "return_completed",
      ];

      allStatuses.forEach((status) => {
        expect(STATUS_CATEGORIES[status]).toBeDefined();
      });
    });
  });

  describe("STATUS_LABELS completeness", () => {
    it("should have labels for all OrderStatusType values", () => {
      const allStatuses: OrderStatusType[] = [
        "pending",
        "payment_pending",
        "payment_processing",
        "payment_confirmed",
        "payment_failed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refunded",
        "partially_refunded",
        "delivery_exception",
        "return_requested",
        "return_in_progress",
        "return_completed",
      ];

      allStatuses.forEach((status) => {
        expect(STATUS_LABELS[status]).toBeDefined();
      });
    });
  });
});
