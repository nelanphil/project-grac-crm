import { Router } from "express";
import {
  getInvoiceByPayToken,
  startCheckoutByPayToken,
} from "../controllers/invoice.controller";

const router = Router();

router.get("/:token", getInvoiceByPayToken);
router.post("/:token/checkout", startCheckoutByPayToken);

export default router;
