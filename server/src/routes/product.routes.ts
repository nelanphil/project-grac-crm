import { Router } from "express";
import {
  authenticate,
  requireAnyPermission,
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

const canReadCatalog = requireAnyPermission(
  "products:read",
  "estimates:write",
  "jobs:write",
);

router.get("/", canReadCatalog, getProducts);
router.get("/:id", canReadCatalog, getProductById);
router.post(
  "/",
  requireAnyPermission("products:write", "estimates:write", "jobs:write"),
  createProduct,
);
router.patch("/:id", requirePermission("products:write"), updateProduct);
router.delete("/:id", requirePermission("products:delete"), deleteProduct);

export default router;
