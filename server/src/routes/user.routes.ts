import { Router, Response } from "express";
import { authenticate, requirePermission, AuthRequest } from "../middleware/auth.middleware";
import {
  listUsers,
  createUser,
  updateUser,
  updateUserRole,
  softDeleteUser,
} from "../controllers/user.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  requirePermission("users:read"),
  (req, res: Response) => listUsers(req as AuthRequest, res)
);

router.post(
  "/",
  authenticate,
  requirePermission("users:write"),
  (req, res: Response) => createUser(req as AuthRequest, res)
);

router.patch(
  "/:id",
  authenticate,
  requirePermission("users:write"),
  (req, res: Response) => updateUser(req as AuthRequest, res)
);

router.patch(
  "/:id/role",
  authenticate,
  requirePermission("users:write"),
  (req, res: Response) => updateUserRole(req as AuthRequest, res)
);

router.delete(
  "/:id",
  authenticate,
  requirePermission("users:delete"),
  (req, res: Response) => softDeleteUser(req as AuthRequest, res)
);

export default router;
