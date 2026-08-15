import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  listPublicAssets,
  uploadPublicAsset,
  updatePublicAssetStatus,
} from "../controllers/publicAsset.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authenticate, requireRole("super-admin"), listPublicAssets);
router.post(
  "/",
  authenticate,
  requireRole("super-admin"),
  upload.single("file"),
  uploadPublicAsset,
);
router.patch(
  "/:id/status",
  authenticate,
  requireRole("super-admin"),
  updatePublicAssetStatus,
);

export default router;
