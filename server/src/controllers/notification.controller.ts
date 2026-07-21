import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  listForUser,
  markAllRead,
  markRead,
  unreadCount,
} from "../services/notification.service";

export async function getNotifications(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 30;
  const before =
    typeof req.query.before === "string" ? req.query.before : undefined;

  const result = await listForUser(
    { id: req.user.id, role: req.user.role },
    { limit, before }
  );

  res.json(result);
}

export async function getUnreadCount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const count = await unreadCount({ id: req.user.id, role: req.user.role });
  res.json({ count });
}

export async function markNotificationRead(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const id = String(req.params.id ?? "");
  const ok = await markRead({ id: req.user.id, role: req.user.role }, id);
  if (!ok) {
    res.status(404).json({ message: "Notification not found" });
    return;
  }

  res.json({ ok: true });
}

export async function markAllNotificationsRead(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const marked = await markAllRead({ id: req.user.id, role: req.user.role });
  res.json({ marked });
}
