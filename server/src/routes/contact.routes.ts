import { Router } from "express";
import {
  authenticate,
  requireAnyPermission,
} from "../middleware/auth.middleware";
import {
  attachStandaloneContact,
  createStandaloneContact,
  searchContacts,
  updateStandaloneContact,
} from "../controllers/contact.controller";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requireAnyPermission("customers:read", "messages:read"),
  searchContacts,
);
router.post(
  "/",
  requireAnyPermission("customers:write", "messages:write"),
  createStandaloneContact,
);
router.patch(
  "/:id",
  requireAnyPermission("customers:write", "messages:write"),
  updateStandaloneContact,
);
router.post(
  "/:id/attach",
  requireAnyPermission("customers:write", "messages:write"),
  attachStandaloneContact,
);

export default router;
