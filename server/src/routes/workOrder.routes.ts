import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  getWorkOrders,
  getWorkOrderById,
  getWorkOrdersByCustomer,
  createWorkOrder,
  updateWorkOrder,
  cancelWorkOrderAppointment,
  deleteWorkOrder,
} from "../controllers/workOrder.controller";

const router = Router();

router.use(authenticate);

router.get("/", getWorkOrders);
router.get("/by-customer/:customerId", getWorkOrdersByCustomer);
router.get("/:id", getWorkOrderById);
router.post("/", createWorkOrder);
router.patch("/:id", updateWorkOrder);
router.post("/:id/cancel-appointment", cancelWorkOrderAppointment);
router.delete("/:id", deleteWorkOrder);

export default router;
