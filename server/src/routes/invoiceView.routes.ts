import { Router } from "express";
import { getInvoiceByViewToken } from "../controllers/invoice.controller";

const router = Router();

router.get("/:token", getInvoiceByViewToken);

export default router;
