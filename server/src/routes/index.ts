import { Router, Request, Response } from "express";
import { getMongoStatus } from "../config/mongodb";
import { getMySQLStatus } from "../config/mysql";
import authRoutes from "./auth.routes";
import leadRoutes from "./lead.routes";
import userRoutes from "./user.routes";
import territoryRoutes from "./territory.routes";
import roleRoutes from "./role.routes";
import workOrderRoutes from "./workOrder.routes";
import customerRoutes from "./customer.routes";
import contractRoutes from "./contract.routes";
import contractTemplateRoutes from "./contractTemplate.routes";
import twilioAccountRoutes from "./twilioAccount.routes";
import googleCredentialsRoutes from "./googleCredentials.routes";
import notificationRoutes from "./notification.routes";
import messageTemplateRoutes from "./messageTemplate.routes";
import messagingRoutes from "./messaging.routes";
import paymentProviderAccountRoutes from "./paymentProviderAccount.routes";
import invoiceRoutes from "./invoice.routes";
import payLinkRoutes from "./payLink.routes";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    mongo: getMongoStatus(),
    mysql: getMySQLStatus(),
  });
});

router.use("/auth", authRoutes);
router.use("/leads", leadRoutes);
router.use("/users", userRoutes);
router.use("/territories", territoryRoutes);
router.use("/roles", roleRoutes);
router.use("/work-orders", workOrderRoutes);
router.use("/customers", customerRoutes);
router.use("/contracts", contractRoutes);
router.use("/contract-templates", contractTemplateRoutes);
router.use("/twilio-accounts", twilioAccountRoutes);
router.use("/google-credentials", googleCredentialsRoutes);
router.use("/message-templates", messageTemplateRoutes);
router.use("/messaging", messagingRoutes);
router.use("/notifications", notificationRoutes);
router.use("/payment-provider-accounts", paymentProviderAccountRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/pay", payLinkRoutes);

export default router;
