import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  getDefaultInvoiceTemplate,
  getInvoiceTemplates,
  updateInvoiceTemplate,
  uploadInvoiceTemplateImage,
  uploadInvoiceTemplateImageMiddleware,
} from "../controllers/invoiceTemplate.controller";

const router = Router();

router.use(authenticate);

router.get("/default", getDefaultInvoiceTemplate);
router.post(
  "/images",
  requirePermission("contracts:write"),
  uploadInvoiceTemplateImageMiddleware,
  uploadInvoiceTemplateImage,
);

router.get("/", requirePermission("contracts:write"), getInvoiceTemplates);
router.post("/", requirePermission("contracts:write"), createInvoiceTemplate);
router.patch(
  "/:id",
  requirePermission("contracts:write"),
  updateInvoiceTemplate,
);
router.delete(
  "/:id",
  requirePermission("contracts:write"),
  deleteInvoiceTemplate,
);

export default router;
