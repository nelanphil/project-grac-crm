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
  getInvoiceActivity,
  getInvoiceById,
  getInvoiceVisit,
  getInvoiceVisitSnapshot,
  getInvoices,
  getPendingPayments,
  getPaidRenewals,
  bulkCreateRenewalWorkOrders,
  createRenewalWorkOrderForInvoice,
  dismissPaidRenewalInvoice,
  linkRenewalWorkOrderForInvoice,
  resendRenewalScheduleEmail,
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
router.get("/paid-renewals", getPaidRenewals);
router.post(
  "/paid-renewals/bulk-work-orders",
  requirePermission("contracts:write"),
  bulkCreateRenewalWorkOrders,
);
router.get("/:id/activity", getInvoiceActivity);
router.get("/:id/visits/:sessionId", getInvoiceVisit);
router.get("/:id/visits/:sessionId/snapshots/:snapshotId", getInvoiceVisitSnapshot);
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
router.post(
  "/:id/renewal-work-order",
  requirePermission("contracts:write"),
  createRenewalWorkOrderForInvoice,
);
router.post(
  "/:id/renewal-work-order/link",
  requirePermission("contracts:write"),
  linkRenewalWorkOrderForInvoice,
);
router.post(
  "/:id/renewal-work-order/dismiss",
  requirePermission("contracts:write"),
  dismissPaidRenewalInvoice,
);
router.post(
  "/:id/renewal-schedule-email",
  requirePermission("contracts:write"),
  resendRenewalScheduleEmail,
);

export default router;
