import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  getContracts,
  getContractById,
  createContract,
  updateContract,
  updateContractPeriod,
  renewContract,
  deleteContract,
  restoreContract,
} from "../controllers/contract.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("contracts:read"), getContracts);
router.get("/:id", requirePermission("contracts:read"), getContractById);
router.post("/", requirePermission("contracts:write"), createContract);
router.patch("/:id", requirePermission("contracts:write"), updateContract);
router.patch(
  "/:id/period",
  requirePermission("contracts:write"),
  updateContractPeriod,
);
router.post("/:id/renew", requirePermission("contracts:write"), renewContract);
router.post("/:id/restore", requirePermission("contracts:delete"), restoreContract);
router.delete("/:id", requirePermission("contracts:delete"), deleteContract);

export default router;
