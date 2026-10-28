import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  completeTask,
  createTask,
  deleteTask,
  listTaskAssignees,
  listTasks,
  reopenTask,
  updateTask,
} from "../controllers/tasks.controller";

const router = Router();

router.use(authenticate);

router.get("/assignees", requirePermission("tasks:read"), listTaskAssignees);
router.get("/", requirePermission("tasks:read"), listTasks);
router.post("/", requirePermission("tasks:write"), createTask);
router.post("/:id/complete", completeTask);
router.post("/:id/reopen", reopenTask);
router.patch("/:id", requirePermission("tasks:write"), updateTask);
router.delete("/:id", requirePermission("tasks:write"), deleteTask);

export default router;
