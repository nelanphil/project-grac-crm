import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  getWorkOrders,
  getWorkOrderById,
  getWorkOrderActivity,
  getWorkOrdersByCustomer,
  createWorkOrder,
  updateWorkOrder,
  cancelWorkOrderAppointment,
  deleteWorkOrder,
  restoreWorkOrder,
  getWorkOrderCompletion,
  postWorkOrderComplete,
  postWorkOrderPaymentProof,
  postWorkOrderSendReceipt,
  uploadWorkOrderPaymentProofMiddleware,
} from "../controllers/workOrder.controller";
import {
  getRecentWorkOrderNotes,
  listWorkOrderNoteHistory,
  getWorkOrderNotes,
  createWorkOrderNote,
  updateWorkOrderNote,
  deleteWorkOrderNote,
} from "../controllers/workOrderNote.controller";

const router = Router();

router.use(authenticate);

router.get("/recent-notes", getRecentWorkOrderNotes);
router.get("/notes", listWorkOrderNoteHistory);
router.get("/", getWorkOrders);
router.get("/by-customer/:customerId", getWorkOrdersByCustomer);
router.get("/:id/notes", getWorkOrderNotes);
router.get("/:id/activity", getWorkOrderActivity);
router.post("/:id/notes", createWorkOrderNote);
router.patch("/:id/notes/:noteId", updateWorkOrderNote);
router.delete("/:id/notes/:noteId", deleteWorkOrderNote);
router.get(
  "/:id/completion-check",
  requirePermission("jobs:write"),
  getWorkOrderCompletion,
);
router.post(
  "/:id/complete",
  requirePermission("jobs:write"),
  postWorkOrderComplete,
);
router.post(
  "/:id/payment-proof",
  requirePermission("jobs:write"),
  uploadWorkOrderPaymentProofMiddleware,
  postWorkOrderPaymentProof,
);
router.post(
  "/:id/send-receipt",
  requirePermission("jobs:write"),
  postWorkOrderSendReceipt,
);
router.get("/:id", getWorkOrderById);
router.post("/", createWorkOrder);
router.patch("/:id", updateWorkOrder);
router.post("/:id/cancel-appointment", cancelWorkOrderAppointment);
router.post("/:id/restore", restoreWorkOrder);
router.delete("/:id", deleteWorkOrder);

export default router;
