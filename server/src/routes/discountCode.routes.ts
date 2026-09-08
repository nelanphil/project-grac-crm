import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  createDiscountCode,
  deleteDiscountCode,
  getDiscountCodeById,
  getDiscountCodes,
  updateDiscountCode,
} from "../controllers/discountCode.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("discounts:read"), getDiscountCodes);
router.get("/:id", requirePermission("discounts:read"), getDiscountCodeById);
router.post("/", requirePermission("discounts:write"), createDiscountCode);
router.patch("/:id", requirePermission("discounts:write"), updateDiscountCode);
router.delete("/:id", requirePermission("discounts:delete"), deleteDiscountCode);

export default router;
