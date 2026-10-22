import { Router } from "express";
import {
  listContactNames,
  listCustomerNames,
  updateContactName,
  updateCustomerName,
} from "../controllers/nameReport.controller";
import { authenticate, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(requireRole("super-admin"));

router.get("/customers", listCustomerNames);
router.patch("/customers/:id", updateCustomerName);
router.get("/contacts", listContactNames);
router.patch("/contacts/:id", updateContactName);

export default router;
