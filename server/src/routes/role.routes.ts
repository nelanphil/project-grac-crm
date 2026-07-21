import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, requireRole, AuthRequest } from "../middleware/auth.middleware";
import { RolePermission } from "../models/mongo/RolePermission";
import { Role } from "../models/mongo/Role";
import { User } from "../models/mongo/User";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

const router = Router();

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)),
});

const createRoleSchema = z.object({
  label: z.string().min(1).max(60).trim(),
});

const updateRoleLabelSchema = z.object({
  label: z.string().min(1).max(60).trim(),
});

const renameRoleSchema = z.object({
  label: z.string().min(1).max(60).trim(),
  slug: z
    .string()
    .min(1)
    .max(60)
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens"),
});

// GET /roles — list all non-deleted roles (authenticated)
router.get(
  "/",
  authenticate,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const roles = await Role.find({ deletedAt: null }).lean().sort({ createdAt: 1 });
      res.status(200).json({ roles });
    } catch (err) {
      console.error("GET /roles error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// POST /roles — create a new role (super-admin only)
router.post(
  "/",
  authenticate,
  requireRole("super-admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const { label } = parsed.data;
    const slug = label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    try {
      const existing = await Role.findOne({ slug });
      if (existing) {
        if (existing.deletedAt) {
          existing.deletedAt = null;
          existing.label = label;
          await existing.save();

          logNotificationAsync({
            entityType: "role",
            action: "updated",
            entityId: String(existing._id),
            summary: `Role ${existing.slug} restored`,
            metadata: { slug: existing.slug, label: existing.label },
            ...actorFromRequest(req.user),
          });

          res.status(200).json({ role: existing });
        } else {
          res.status(409).json({ message: "A role with that name already exists" });
        }
        return;
      }

      const role = await Role.create({ slug, label, isSystem: false });

      logNotificationAsync({
        entityType: "role",
        action: "created",
        entityId: String(role._id),
        summary: `Role ${role.slug} created`,
        metadata: { slug: role.slug, label: role.label },
        ...actorFromRequest(req.user),
      });

      res.status(201).json({ role });
    } catch (err) {
      console.error("POST /roles error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PATCH /roles/:slug/rename — update both slug and label with cascade (super-admin only)
router.patch(
  "/:slug/rename",
  authenticate,
  requireRole("super-admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = renameRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const oldSlug = req.params.slug;
    const { slug: newSlug, label } = parsed.data;

    try {
      const role = await Role.findOne({ slug: oldSlug, deletedAt: null });
      if (!role) {
        res.status(404).json({ message: "Role not found" });
        return;
      }

      // Check new slug isn't already taken by a different role
      if (newSlug !== oldSlug) {
        const conflict = await Role.findOne({ slug: newSlug, deletedAt: null });
        if (conflict) {
          res.status(409).json({ message: "A role with that slug already exists" });
          return;
        }
      }

      // Cascade: update all users and role permissions referencing the old slug
      if (newSlug !== oldSlug) {
        await Promise.all([
          User.updateMany({ role: oldSlug }, { role: newSlug }),
          RolePermission.updateMany({ role: oldSlug }, { role: newSlug }),
        ]);
      }

      role.slug = newSlug;
      role.label = label;
      await role.save();

      logNotificationAsync({
        entityType: "role",
        action: "updated",
        entityId: String(role._id),
        summary: `Role renamed to ${role.slug}`,
        metadata: { slug: role.slug, label: role.label, oldSlug },
        ...actorFromRequest(req.user),
      });

      res.status(200).json({ role, oldSlug });
    } catch (err) {
      console.error("PATCH /roles/:slug/rename error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PATCH /roles/:slug/label — update display label only (super-admin only)
router.patch(
  "/:slug/label",
  authenticate,
  requireRole("super-admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = updateRoleLabelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    try {
      const role = await Role.findOneAndUpdate(
        { slug: req.params.slug, deletedAt: null },
        { label: parsed.data.label },
        { new: true }
      );
      if (!role) {
        res.status(404).json({ message: "Role not found" });
        return;
      }

      logNotificationAsync({
        entityType: "role",
        action: "updated",
        entityId: String(role._id),
        summary: `Role ${role.slug} label updated`,
        metadata: { slug: role.slug, label: role.label },
        ...actorFromRequest(req.user),
      });

      res.status(200).json({ role });
    } catch (err) {
      console.error("PATCH /roles/:slug/label error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// DELETE /roles/:slug — soft delete (super-admin, custom roles only)
router.delete(
  "/:slug",
  authenticate,
  requireRole("super-admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const role = await Role.findOne({ slug: req.params.slug, deletedAt: null });
      if (!role) {
        res.status(404).json({ message: "Role not found" });
        return;
      }
      if (role.isSystem) {
        res.status(403).json({ message: "System roles cannot be deleted" });
        return;
      }
      role.deletedAt = new Date();
      await role.save();

      logNotificationAsync({
        entityType: "role",
        action: "deleted",
        entityId: String(role._id),
        summary: `Role ${role.slug} deleted`,
        metadata: { slug: role.slug, label: role.label },
        ...actorFromRequest(req.user),
      });

      res.status(200).json({ message: "Role deleted" });
    } catch (err) {
      console.error("DELETE /roles/:slug error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /roles/permissions — all role→permission mappings (super-admin)
router.get(
  "/permissions",
  authenticate,
  requireRole("super-admin"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const docs = await RolePermission.find({}).lean().sort({ role: 1, permission: 1 });
      const grouped: Record<string, string[]> = {};
      for (const doc of docs) {
        if (!grouped[doc.role]) grouped[doc.role] = [];
        grouped[doc.role].push(doc.permission);
      }
      res.status(200).json({ roles: grouped });
    } catch (err) {
      console.error("GET /roles/permissions error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// PUT /roles/:role/permissions — replace permission set for a role (super-admin)
router.put(
  "/:role/permissions",
  authenticate,
  requireRole("super-admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = updateRolePermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }
    const { role } = req.params;
    const roleSlug = Array.isArray(role) ? role[0] : role;
    const { permissions } = parsed.data;
    try {
      await RolePermission.deleteMany({ role: roleSlug });
      if (permissions.length > 0) {
        await RolePermission.insertMany(
          permissions.map((permission) => ({ role: roleSlug, permission }))
        );
      }

      logNotificationAsync({
        entityType: "role",
        action: "updated",
        entityId: roleSlug,
        summary: `Permissions updated for role ${roleSlug}`,
        metadata: { slug: roleSlug, permissionCount: permissions.length },
        ...actorFromRequest(req.user),
      });

      res.status(200).json({ role: roleSlug, permissions });
    } catch (err) {
      console.error("PUT /roles/:role/permissions error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
