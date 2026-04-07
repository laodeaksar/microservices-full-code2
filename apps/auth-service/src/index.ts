import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";
import { shouldBeAdmin } from "./middleware/authMiddleware.js";
import userRoute from "./routes/user.route";
import rateLimiters, { createRateLimiter } from "@repo/rate-limiter";

dotenv.config();

const app = express();

const allowedOrigins = [
  "http://localhost:3003",
  "https://neuraltale-admin.onrender.com",
  "https://backoffice.neuraltale.com",
  process.env.ADMIN_URL,
].filter((origin): origin is string => Boolean(origin));

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(clerkMiddleware());

// ============================================================
// Trust Proxy
// ============================================================
app.set("trust proxy", true);

// ============================================================
// Rate Limiting - Auth endpoints require strict limits
// ============================================================

// Auth endpoints - strict rate limiting to prevent brute force
app.use(
  "/users/auth",
  createRateLimiter({
    preset: "authEndpoints",
    customOptions: {
      keyGenerator: (req) => `ip:${req.ip}`, // IP-only for auth
      message: {
        error: "Too Many Authentication Attempts",
        message: "Too many authentication attempts. Please wait 15 minutes before trying again.",
      },
    },
  })
);

// General user endpoints - moderate limits
app.use("/users", rateLimiters.authenticated, shouldBeAdmin, userRoute);

// Add request logging for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health endpoint
app.get("/health", (req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.log(err);
  return res
    .status(err.status || 500)
    .json({ message: err.message || "Inter Server Error!" });
});

const PORT = Number(process.env.PORT) || 8003;

const start = async () => {
  try {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Auth service is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start auth service:", error);
    process.exit(1);
  }
};

start();
