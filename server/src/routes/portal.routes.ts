import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  createPortalAddress,
  createPortalContact,
  deletePortalAddress,
  deletePortalContact,
  getPortalHome,
  updatePortalAddress,
  updatePortalContact,
} from "../controllers/portal.controller";

const router = Router();

router.get("/home", authenticate, getPortalHome);
router.post("/addresses", authenticate, createPortalAddress);
router.patch("/addresses/:addressId", authenticate, updatePortalAddress);
router.delete("/addresses/:addressId", authenticate, deletePortalAddress);
router.post("/contacts", authenticate, createPortalContact);
router.patch("/contacts/:contactId", authenticate, updatePortalContact);
router.delete("/contacts/:contactId", authenticate, deletePortalContact);

export default router;
