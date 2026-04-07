import { Router } from "express";
import {
  createCategory,
  deleteCategory,
  getCategories,
  getCategory,
  updateCategory,
} from "../controllers/category.controller";
import { shouldBeAdmin } from "../middleware/authMiddleware";
import rateLimiters from "@repo/rate-limiter";

const router: Router = Router();

// Write operations - admin only, stricter limits
router.post("/",rateLimiters.writeOperations, shouldBeAdmin, createCategory);
router.put("/:id",rateLimiters.writeOperations, shouldBeAdmin, updateCategory);
router.delete("/:id",rateLimiters.writeOperations, shouldBeAdmin, deleteCategory);

// Read operations - public, relaxed limits
router.get("/",rateLimiters.publicReadRelaxed, getCategories);
router.get("/:id",rateLimiters.publicReadRelaxed, getCategory);

export default router;
