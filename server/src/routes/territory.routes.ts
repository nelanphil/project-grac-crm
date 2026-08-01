import { Router, Response } from "express";
import {
  authenticate,
  requireRole,
  AuthRequest,
} from "../middleware/auth.middleware";
import {
  listTerritories,
  updateTerritories,
} from "../controllers/territory.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  requireRole("owner", "admin", "super-admin"),
  (req, res: Response) => listTerritories(req as AuthRequest, res),
);

router.patch(
  "/:userId",
  authenticate,
  requireRole("owner", "admin", "super-admin"),
  (req, res: Response) => updateTerritories(req as AuthRequest, res),
);

export default router;
