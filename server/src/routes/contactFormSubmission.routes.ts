import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  importContactFormMailbox,
  listContactFormSubmissions,
  markContactFormSubmissionRead,
} from "../controllers/contactFormSubmission.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("admin", "super-admin"));

router.get("/", requirePermission("messages:read"), listContactFormSubmissions);
router.post(
  "/import",
  requirePermission("messages:write"),
  importContactFormMailbox,
);
router.post(
  "/:id/read",
  requirePermission("messages:read"),
  markContactFormSubmissionRead,
);

export default router;
