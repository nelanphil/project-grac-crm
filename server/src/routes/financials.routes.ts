import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  getFinancialsOwners,
  getFinancialsRecords,
  getFinancialsSummary,
} from "../controllers/financials.controller";

const router = Router();

router.use(authenticate);
router.get("/owners", requirePermission("reports:read"), getFinancialsOwners);
router.get("/summary", requirePermission("reports:read"), getFinancialsSummary);
router.get("/records", requirePermission("reports:read"), getFinancialsRecords);

export default router;
