import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  createInvoice,
  createInvoicePayLink,
  getInvoiceById,
  getInvoices,
  markInvoicePaidByStaff,
  reopenInvoiceByStaff,
  startInvoiceCheckout,
  updateInvoiceTax,
} from "../controllers/invoice.controller";

const router = Router();

router.use(authenticate);

router.get("/", getInvoices);
router.get("/:id", getInvoiceById);

router.post("/", requirePermission("contracts:write"), createInvoice);
router.patch(
  "/:id/tax",
  requirePermission("contracts:write"),
  updateInvoiceTax,
);
router.post("/:id/checkout", startInvoiceCheckout);
router.post(
  "/:id/pay-link",
  requirePermission("contracts:write"),
  createInvoicePayLink,
);
router.post(
  "/:id/mark-paid",
  requirePermission("contracts:write"),
  markInvoicePaidByStaff,
);
router.post(
  "/:id/reopen",
  requirePermission("contracts:write"),
  reopenInvoiceByStaff,
);

export default router;
