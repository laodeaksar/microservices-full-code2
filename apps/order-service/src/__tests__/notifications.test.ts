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
