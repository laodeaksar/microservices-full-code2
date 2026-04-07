/**
 * Database Migration Script: Order Status Migration
 *
 * Migrates existing orders from the old binary status model to the new
 * multi-state order status flow.
 *
 * Old Status -> New Status Mapping:
 * - "success" -> "delivered" (assuming fulfilled orders were delivered)
 * - "failed" -> "payment_failed"
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-order-status.ts
 *
 * IMPORTANT: Run this script ONCE after deploying the new schema.
 * Always backup your database before running migrations.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/orders";

async function migrateOrderStatus() {
  console.log("🚀 Starting order status migration...");
  console.log(`📦 Connecting to MongoDB at ${MONGODB_URI}`);

  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Get the orders collection
    const ordersCollection = mongoose.connection.collection("orders");

    // Get counts before migration
    const successCount = await ordersCollection.countDocuments({
      status: "success",
    });
    const failedCount = await ordersCollection.countDocuments({
      status: "failed",
    });
    const totalCount = await ordersCollection.countDocuments({});

    console.log(`📊 Orders before migration:`);
    console.log(`   - Total: ${totalCount}`);
    console.log(`   - success: ${successCount}`);
    console.log(`   - failed: ${failedCount}`);

    // Migrate "success" -> "delivered"
    const successResult = await ordersCollection.updateMany(
      { status: "success" },
      {
        $set: {
          status: "delivered",
          actualDeliveryDate: new Date(),
          statusHistory: [
            {
              from: null,
              to: "delivered",
              reason: "Migrated from legacy 'success' status",
              changedBy: "system",
              changedAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(`✅ Migrated ${successResult.modifiedCount} 'success' orders to 'delivered'`);

    // Migrate "failed" -> "payment_failed"
    const failedResult = await ordersCollection.updateMany(
      { status: "failed" },
      {
        $set: {
          status: "payment_failed",
          statusHistory: [
            {
              from: null,
              to: "payment_failed",
              reason: "Migrated from legacy 'failed' status",
              changedBy: "system",
              changedAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(`✅ Migrated ${failedResult.modifiedCount} 'failed' orders to 'payment_failed'`);

    // Initialize statusHistory for orders that don't have it
    const noHistoryResult = await ordersCollection.updateMany(
      { statusHistory: { $exists: false } },
      {
        $set: {
          statusHistory: [
            {
              from: null,
              to: "$status",
              reason: "Initialized during migration",
              changedBy: "system",
              changedAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(`✅ Initialized statusHistory for ${noHistoryResult.modifiedCount} orders`);

    // Get counts after migration
    const newStatusCounts = await ordersCollection.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();

    console.log(`📊 Orders after migration:`);
    newStatusCounts.forEach((item) => {
      console.log(`   - ${item._id}: ${item.count}`);
    });

    console.log("🎉 Order status migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  }
}

// Run migration
migrateOrderStatus();
