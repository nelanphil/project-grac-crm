import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  getNoteTemplates,
  createNoteTemplate,
  updateNoteTemplate,
  deleteNoteTemplate,
} from "../controllers/noteTemplate.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("jobs:read"), getNoteTemplates);
router.post("/", requirePermission("jobs:write"), createNoteTemplate);
router.patch("/:id", requirePermission("jobs:write"), updateNoteTemplate);
router.delete("/:id", requirePermission("jobs:write"), deleteNoteTemplate);

export default router;
