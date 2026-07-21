import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notification.controller";

const router = Router();

router.use(authenticate);

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.post("/read-all", markAllNotificationsRead);
router.post("/:id/read", markNotificationRead);

export default router;
