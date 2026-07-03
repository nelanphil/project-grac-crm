import { Router, Response } from "express";
import mongoose from "mongoose";
import { authenticate, requirePermission, AuthRequest } from "../middleware/auth.middleware";
import { Customer } from "../models/mongo/Customer";

const router = Router();

// GET /customers — list all customers (requires customers:read)
router.get(
  "/",
  authenticate,
  requirePermission("customers:read"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const customers = await Customer.find().lean().sort({ last: 1, first: 1 });
      res.status(200).json({ customers });
    } catch (err) {
      console.error("GET /customers error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// GET /customers/:id — single customer by MongoDB _id (requires customers:read)
router.get(
  "/:id",
  authenticate,
  requirePermission("customers:read"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ message: "Invalid customer id" });
        return;
      }

      const customer = await Customer.findById(id).lean();
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }

      res.status(200).json({ customer });
    } catch (err) {
      console.error("GET /customers/:id error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
