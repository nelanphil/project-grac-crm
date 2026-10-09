import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { User, activeUserFilter } from "../models/mongo/User";
import { isCustomerRole } from "../utils/roles";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function searchMentionableUsers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user || isCustomerRole(req.user)) {
    res.status(403).json({ message: "Staff only" });
    return;
  }

  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filter: Record<string, unknown> = {
    ...activeUserFilter,
    userType: "staff",
  };
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ first_name: re }, { last_name: re }];
  }

  const users = await User.find(filter)
    .select("first_name last_name")
    .sort({ first_name: 1, last_name: 1 })
    .limit(8)
    .lean();

  res.json({
    users: users.map((user) => ({
      id: String(user._id),
      firstName: user.first_name,
      lastName: user.last_name,
    })),
  });
}
