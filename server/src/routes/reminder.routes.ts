import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  listReminders,
  updateReminderCompleted,
} from "../controllers/reminder.controller";

const router = Router();

router.use(authenticate);
router.get("/", listReminders);
router.patch("/:source/:noteId", updateReminderCompleted);

export default router;
