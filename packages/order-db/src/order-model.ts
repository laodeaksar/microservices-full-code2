import mongoose, { InferSchemaType, model } from "mongoose";
const { Schema } = mongoose;

// export const OrderStatus = ["success", "failed"] as const;
export const OrderStatus = [
    "pending",
     "payment_pending",
     "payment_processing",                                        "payment_confirmed",
      "payment_failed",                                            "confirmed",
     "processing",
     "partially_shipped",                                        "shipped",                                                   "out_for_delivery",
       "delivered",
      "cancelled",
      "refunded",                                                 "partially_refunded",
   "delivery_exception",
     "return_requested",
     "return_in_progress",
     "return_completed",
   ] as const;
    
const OrderSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, required: true, enum: OrderStatus, default: "pending" },

    // Payment details
    paymentIntentId: { type: String },                            paymentMethod: { type: String },                              paymentCompletedAt: { type: Date },                                                                                         // Shipping details                                       
    shippingAddress: {                                            fullName: { type: String },                                 line1: { type: String },                                        line2: { type: String },                                      city: { type: String },                                      state: { type: String },                                     postalCode: { type: String },
     country: { type: String },
     phone: { type: String },                                     },                                                             estimatedDeliveryDate: { type: Date },
     actualDeliveryDate: { type: Date },

     // Shipment tracking
    shipments: [
      {
        trackingNumber: { type: String },
        carrier: { type: String },
        items: [{ productId: String, quantity: Number }],
        shippedAt: { type: Date },
        deliveredAt: { type: Date },
        status: { type: String },
      },
    ],

    // Cancellation details
    cancellationReason: { type: String },
    cancelledBy: { type: String }, // "user" or "admin"
    cancelledAt: { type: Date },

    // Refund details
    refunds: [
      {
        amount: { type: Number },
        reason: { type: String },
        refundIntentId: { type: String },
        status: { type: String },
        createdAt: { type: Date },
      },
    ],

    // Products with per-item status for partial shipments
    products: {
      type: [
        {
          name: { type: String, required: true },
          quantity: { type: Number, required: true },
          price: { type: Number, required: true },
          status: {
            type: String,
            enum: ["pending", "shipped", "delivered", "refunded"],
            default: "pending",
          },
          shipmentId: { type: String },
        },
      ],
      required: true,
    },
    /* products: {
      type: [
        {
          name: { type: String, required: true },
          quantity: { type: Number, required: true },
          price: { type: Number, required: true },
        },
      ], */

    // Status change audit log
    statusHistory: [
      {
        from: { type: String },
        to: { type: String },
        reason: { type: String },
        changedBy: { type: String, default: "system" }, // "system", "user", "admin"
        changedAt: { type: Date, default: Date.now },
      },
    ],

    // Notification preferences
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
    },
  },
      required: true,
    },
  },
  idempotencyKey: { type: String, unique: true, sparse: true }, 
  { timestamps: true },
);

export type OrderSchemaType = InferSchemaType<typeof OrderSchema>;

export const Order = model<OrderSchemaType>("Order", OrderSchema);
