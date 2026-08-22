import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/product.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("products:read"), getProducts);
router.get("/:id", requirePermission("products:read"), getProductById);
router.post("/", requirePermission("products:write"), createProduct);
router.patch("/:id", requirePermission("products:write"), updateProduct);
router.delete("/:id", requirePermission("products:delete"), deleteProduct);

export default router;
