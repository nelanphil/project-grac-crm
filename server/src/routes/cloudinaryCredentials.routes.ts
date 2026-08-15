import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getCloudinaryCredentials,
  saveCloudinaryCredentials,
  deleteCloudinaryCredentials,
} from "../controllers/cloudinaryCredentials.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("super-admin"));

router.get("/", getCloudinaryCredentials);
router.put("/", saveCloudinaryCredentials);
router.delete("/", deleteCloudinaryCredentials);

export default router;
