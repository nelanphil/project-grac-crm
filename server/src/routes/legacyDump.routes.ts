import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  auditLegacyDump,
  executeLegacyDump,
  listLegacyDumpTargets,
  runLegacyDumpCommand,
} from "../controllers/legacyDump.controller";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
});

router.use(authenticate, requireRole("super-admin"));

router.get("/targets", listLegacyDumpTargets);
router.post("/audit", upload.array("files", 2), auditLegacyDump);
router.post("/execute", upload.array("files", 2), executeLegacyDump);
router.post("/command", upload.array("files", 2), runLegacyDumpCommand);

export default router;
