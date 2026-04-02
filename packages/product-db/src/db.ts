import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema"; // Path to your schema file

// Configure WebSocket for Node.js environment
neonConfig.webSocketConstructor = ws;

/**
 * Drizzle doesn't have a "PrismaClient" type;
 * we define the database type based on the driver.
 */
const globalForDrizzle = global as unknown as {
  conn: Pool | undefined;
};

function createDrizzleClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("❌ DATABASE_URL is not set in environment variables");
  }

  console.log("🔌 Connecting to Neon via Drizzle + WebSocket...");

  // 1. Initialize the Pool
  const pool = new Pool({ connectionString });

  // 2. Initialize Drizzle with the pool and your schema
  return drizzle(pool, { schema });
}

// Singleton logic for HMR (Hot Module Replacement)
export const db = globalForDrizzle.conn
  ? drizzle(globalForDrizzle.conn, { schema })
  : createDrizzleClient();

if (process.env.NODE_ENV !== "production") {
  // Store the pool connection to reuse across reloads
  // We store the pool rather than the drizzle object for stability
  globalForDrizzle.conn = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
}
