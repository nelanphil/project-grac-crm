import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  createTask,
  deleteTask,
  listTaskAssignees,
  listTasks,
  updateTask,
} from "../controllers/tasks.controller";

const router = Router();

router.use(authenticate);

router.get("/assignees", requirePermission("tasks:read"), listTaskAssignees);
router.get("/", requirePermission("tasks:read"), listTasks);
router.post("/", requirePermission("tasks:write"), createTask);
router.patch("/:id", requirePermission("tasks:write"), updateTask);
router.delete("/:id", requirePermission("tasks:write"), deleteTask);

export default router;
