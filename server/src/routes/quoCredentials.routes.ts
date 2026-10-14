import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getQuoCredentials,
  saveQuoCredentials,
  deleteQuoCredentials,
} from "../controllers/quoCredentials.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("super-admin"));

router.get("/", getQuoCredentials);
router.put("/", saveQuoCredentials);
router.delete("/", deleteQuoCredentials);

export default router;
