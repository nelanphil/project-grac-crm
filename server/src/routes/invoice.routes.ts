import { Router } from "express";
import {
  authenticate,
  requireAnyPermission,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  bulkUpdateInvoiceStatus,
  createInvoice,
  createInvoicePayLink,
  getInvoiceById,
  getInvoices,
  getPendingPayments,
  markInvoicePaidByStaff,
  reopenInvoiceByStaff,
  confirmInvoicePosCharge,
  reconcileInvoicePosCharge,
  startInvoiceCheckout,
  startInvoicePosCharge,
  updateInvoiceTax,
} from "../controllers/invoice.controller";

const router = Router();

router.use(authenticate);

router.get("/", getInvoices);
router.get("/pending-payments", getPendingPayments);
router.get("/:id", getInvoiceById);

router.post("/", requirePermission("contracts:write"), createInvoice);
router.patch(
  "/:id/tax",
  requirePermission("contracts:write"),
  updateInvoiceTax,
);
router.post(
  "/bulk-status",
  requirePermission("contracts:write"),
  bulkUpdateInvoiceStatus,
);
router.post("/:id/checkout", startInvoiceCheckout);
router.post(
  "/:id/pos-charge",
  requireAnyPermission("contracts:write", "jobs:write"),
  startInvoicePosCharge,
);
router.post(
  "/:id/pos-confirm",
  requireAnyPermission("contracts:write", "jobs:write"),
  confirmInvoicePosCharge,
);
router.post(
  "/:id/pos-reconcile",
  requireAnyPermission("contracts:write", "jobs:write"),
  reconcileInvoicePosCharge,
);
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
