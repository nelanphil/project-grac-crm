import { Router, Response } from "express";
import { authenticate, requirePermission, AuthRequest } from "../middleware/auth.middleware";
import {
  createJobRole,
  deleteJobRole,
  listJobRoles,
  updateJobRole,
} from "../controllers/jobRole.controller";

const router = Router();

router.get("/", authenticate, (req, res: Response) =>
  listJobRoles(req as AuthRequest, res),
);

router.post(
  "/",
  authenticate,
  requirePermission("job-roles:manage"),
  (req, res: Response) => createJobRole(req as AuthRequest, res),
);

router.patch(
  "/:id",
  authenticate,
  requirePermission("job-roles:manage"),
  (req, res: Response) => updateJobRole(req as AuthRequest, res),
);

router.delete(
  "/:id",
  authenticate,
  requirePermission("job-roles:manage"),
  (req, res: Response) => deleteJobRole(req as AuthRequest, res),
);

export default router;
