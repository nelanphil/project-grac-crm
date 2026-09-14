import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  createEstimateTemplate,
  deleteEstimateTemplate,
  getEstimateTemplateById,
  getEstimateTemplates,
  setEstimateTemplateDefault,
  updateEstimateTemplate,
} from "../controllers/estimateTemplate.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("estimates:read"), getEstimateTemplates);
router.post("/", requirePermission("estimates:write"), createEstimateTemplate);
router.post(
  "/:id/default",
  requirePermission("estimates:write"),
  setEstimateTemplateDefault,
);
router.get("/:id", requirePermission("estimates:read"), getEstimateTemplateById);
router.patch(
  "/:id",
  requirePermission("estimates:write"),
  updateEstimateTemplate,
);
router.delete(
  "/:id",
  requirePermission("estimates:write"),
  deleteEstimateTemplate,
);

export default router;
