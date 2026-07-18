import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  getContracts,
  getContractById,
  createContract,
  updateContract,
  renewContract,
  deleteContract,
} from "../controllers/contract.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("contracts:read"), getContracts);
router.get("/:id", requirePermission("contracts:read"), getContractById);
router.post("/", requirePermission("contracts:write"), createContract);
router.patch("/:id", requirePermission("contracts:write"), updateContract);
router.post("/:id/renew", requirePermission("contracts:write"), renewContract);
router.delete("/:id", requirePermission("contracts:delete"), deleteContract);

export default router;
