import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  getEstimates,
  getEstimateById,
  createEstimate,
  updateEstimate,
  convertEstimate,
  deleteEstimate,
} from "../controllers/estimate.controller";
import {
  getEstimateNotes,
  createEstimateNote,
  updateEstimateNote,
  deleteEstimateNote,
} from "../controllers/estimateNote.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("estimates:read"), getEstimates);
router.get("/:id/notes", requirePermission("estimates:read"), getEstimateNotes);
router.post("/:id/notes", requirePermission("estimates:write"), createEstimateNote);
router.patch(
  "/:id/notes/:noteId",
  requirePermission("estimates:write"),
  updateEstimateNote,
);
router.delete(
  "/:id/notes/:noteId",
  requirePermission("estimates:write"),
  deleteEstimateNote,
);
router.get("/:id", requirePermission("estimates:read"), getEstimateById);
router.post("/", requirePermission("estimates:write"), createEstimate);
router.patch("/:id", requirePermission("estimates:write"), updateEstimate);
router.post(
  "/:id/convert",
  requirePermission("estimates:write"),
  convertEstimate,
);
router.delete("/:id", requirePermission("estimates:delete"), deleteEstimate);

export default router;
