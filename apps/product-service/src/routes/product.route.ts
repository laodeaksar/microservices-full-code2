import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  updateProduct,
  getHeroProducts,
} from "../controllers/product.controller";
import { shouldBeAdmin } from "../middleware/authMiddleware";
import rateLimiters, { createRateLimiter } from "@repo/rate-limiter";

const router: Router = Router();

//============================================================
// Write Operations - Stricter limits (POST/PUT/DELETE)
// ============================================================
router.post("/", rateLimiters.writeOperations, createProduct);
router.put("/:id", rateLimiters.writeOperations, shouldBeAdmin, updateProduct);
router.delete("/:id", rateLimiters.writeOperations, shouldBeAdmin, deleteProduct);

// ============================================================
// Read Operations - More permissive limits (GET)
// ============================================================
router.get("/hero", rateLimiters.publicReadRelaxed, getHeroProducts);
router.get("/", rateLimiters.publicRead, getProducts);

// Individual product lookup - moderate limits with per-product key
router.get("/:id", createRateLimiter({
  preset: "publicRead",
  customOptions: {
    keyGenerator: (req) => {
      const userId = (req as any).userId;
      const productId = req.params.id;
      return userId
        ? `user:${userId}:product:${productId}`
        : `ip:${req.ip}:product:${productId}`;
    },
    max: 50, // Lower limit for individual product access to prevent scraping
  },
}),
  getProduct);

export default router;
