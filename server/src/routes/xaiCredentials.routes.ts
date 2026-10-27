import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  deleteXaiCredentials,
  getXaiCredentials,
  listXaiModels,
  saveXaiCredentials,
  testXaiCredentials,
} from "../controllers/xaiCredentials.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("super-admin"));

router.get("/", getXaiCredentials);
router.put("/", saveXaiCredentials);
router.delete("/", deleteXaiCredentials);
router.post("/models", listXaiModels);
router.post("/test", testXaiCredentials);

export default router;
