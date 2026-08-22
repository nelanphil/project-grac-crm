import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import { getFinancialsSummary } from "../controllers/financials.controller";

const router = Router();

router.use(authenticate);
router.get("/summary", requirePermission("reports:read"), getFinancialsSummary);

export default router;
