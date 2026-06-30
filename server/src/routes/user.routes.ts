import { Router, Response } from "express";
import { authenticate, requirePermission, AuthRequest } from "../middleware/auth.middleware";
import { User } from "../models/mongo/User";
import { updateRoleSchema } from "../schemas/auth.schema";

const router = Router();

// GET /users — list all users (requires users:read)
router.get(
  "/",
  authenticate,
  requirePermission("users:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const users = await User.find({}, "-password_hash").lean().sort({ createdAt: -1 });
      res.status(200).json({ users });
    } catch (err) {
      console.error("GET /users error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PATCH /users/:id/role — update a user's role (requires users:write)
router.patch(
  "/:id/role",
  authenticate,
  requirePermission("users:write"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    try {
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { role: parsed.data.role },
        { new: true, select: "-password_hash" }
      ).lean();

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.status(200).json({ user });
    } catch (err) {
      console.error("PATCH /users/:id/role error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
