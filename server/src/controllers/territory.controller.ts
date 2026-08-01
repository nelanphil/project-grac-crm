import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { User, activeUserFilter, IUserTerritories } from "../models/mongo/User";
import { updateTerritoriesSchema } from "../schemas/territory.schema";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  findTerritoryConflicts,
  normalizeTerritoriesInput,
  scheduleOwnerReassignment,
} from "../utils/ownerTerritory";

const TERRITORY_ROLES = new Set(["owner", "admin", "super-admin"]);

function formatTerritories(
  territories?: IUserTerritories | null,
): { counties: string[]; zips: string[] } {
  return {
    counties: territories?.counties ?? [],
    zips: territories?.zips ?? [],
  };
}

function formatOwner(user: {
  _id: unknown;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  territories?: IUserTerritories | null;
}) {
  return {
    _id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    territories: formatTerritories(user.territories),
  };
}

function formatConflictMessage(
  conflicts: Awaited<ReturnType<typeof findTerritoryConflicts>>,
): string {
  const parts = conflicts.map((c) => {
    const label = c.type === "county" ? `county ${c.value}` : `ZIP ${c.value}`;
    return `${label} (held by ${c.ownerName || c.ownerId})`;
  });
  return `Territory conflict: ${parts.join("; ")}`;
}

/** GET /territories — owners see self; admin/super-admin see all owners. */
export async function listTerritories(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user || !TERRITORY_ROLES.has(req.user.role)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    if (req.user.role === "owner") {
      const user = await User.findOne({
        _id: req.user.id,
        ...activeUserFilter,
      })
        .select("-password_hash")
        .lean();
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.status(200).json({ owners: [formatOwner(user)] });
      return;
    }

    const owners = await User.find({
      ...activeUserFilter,
      role: "owner",
    })
      .select("-password_hash")
      .sort({ last_name: 1, first_name: 1 })
      .lean();

    res.status(200).json({ owners: owners.map(formatOwner) });
  } catch (err) {
    console.error("GET /territories error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * PATCH /territories/:userId — owner may update self; admin/super-admin may
 * update any owner-role user.
 *
 * Saves territory immediately; customer ownership is recalculated in the
 * background so the request cannot time out on large customer sets.
 */
export async function updateTerritories(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = updateTerritoriesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    if (!req.user || !TERRITORY_ROLES.has(req.user.role)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    const targetId = String(req.params.userId);
    const isSelf = targetId === req.user.id;
    const isOrgAdmin =
      req.user.role === "admin" || req.user.role === "super-admin";

    if (req.user.role === "owner" && !isSelf) {
      res.status(403).json({
        message: "Owners can only update their own territory",
      });
      return;
    }

    if (!isSelf && !isOrgAdmin) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    const user = await User.findOne({ _id: targetId, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (user.role !== "owner") {
      res.status(400).json({
        message: "Territories can only be assigned to owner-role users",
      });
      return;
    }

    const territories = normalizeTerritoriesInput(parsed.data);
    const conflicts = await findTerritoryConflicts(territories, user._id);
    if (conflicts.length > 0) {
      res.status(409).json({
        message: formatConflictMessage(conflicts),
        conflicts,
      });
      return;
    }

    user.territories = territories;
    await user.save();

    scheduleOwnerReassignment(`owner=${String(user._id)}`);

    logNotificationAsync({
      entityType: "user",
      action: "updated",
      entityId: String(user._id),
      summary: `Territory updated for ${user.first_name} ${user.last_name}`.trim(),
      metadata: {
        email: user.email,
        counties: territories.counties,
        zips: territories.zips,
      },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      owner: formatOwner(user),
      reassignment: { status: "started" as const },
    });
  } catch (err) {
    console.error("PATCH /territories/:userId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
