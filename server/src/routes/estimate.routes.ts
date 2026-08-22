import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  getEstimates,
  getEstimateById,
  createEstimate,
  updateEstimate,
  convertEstimate,
  deleteEstimate,
} from "../controllers/estimate.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("estimates:read"), getEstimates);
router.get("/:id", requirePermission("estimates:read"), getEstimateById);
router.post("/", requirePermission("estimates:write"), createEstimate);
router.patch("/:id", requirePermission("estimates:write"), updateEstimate);
router.post(
  "/:id/convert",
  requirePermission("estimates:write"),
  convertEstimate,
);
router.delete("/:id", requirePermission("estimates:delete"), deleteEstimate);

export default router;
