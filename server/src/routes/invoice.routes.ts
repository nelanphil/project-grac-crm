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
  startInvoiceCheckout,
} from "../controllers/invoice.controller";

const router = Router();

router.use(authenticate);

router.get("/", getInvoices);
router.get("/:id", getInvoiceById);

router.post("/", requirePermission("contracts:write"), createInvoice);
router.post("/:id/checkout", startInvoiceCheckout);
router.post(
  "/:id/pay-link",
  requirePermission("contracts:write"),
  createInvoicePayLink,
);

export default router;
