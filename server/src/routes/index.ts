import { Router, Request, Response } from "express";
import { getMongoStatus } from "../config/mongodb";
import { getMySQLStatus } from "../config/mysql";
import {
  getPublicAssetBySlug,
  publicAssetHealth,
} from "../controllers/publicAsset.controller";
import authRoutes from "./auth.routes";
import leadRoutes from "./lead.routes";
import userRoutes from "./user.routes";
import territoryRoutes from "./territory.routes";
import roleRoutes from "./role.routes";
import workOrderRoutes from "./workOrder.routes";
import scheduleRoutes from "./schedule.routes";
import customerRoutes from "./customer.routes";
import contractRoutes from "./contract.routes";
import contractTemplateRoutes from "./contractTemplate.routes";
import twilioAccountRoutes from "./twilioAccount.routes";
import emailAccountRoutes from "./emailAccount.routes";
import googleCredentialsRoutes from "./googleCredentials.routes";
import notificationRoutes from "./notification.routes";
import messageTemplateRoutes from "./messageTemplate.routes";
import messagingRoutes from "./messaging.routes";
import paymentProviderAccountRoutes from "./paymentProviderAccount.routes";
import invoiceRoutes from "./invoice.routes";
import productRoutes from "./product.routes";
import manufacturerRoutes from "./manufacturer.routes";
import estimateRoutes from "./estimate.routes";
import financialsRoutes from "./financials.routes";
import payLinkRoutes from "./payLink.routes";
import cloudinaryCredentialsRoutes from "./cloudinaryCredentials.routes";
import paymentPlatformAppRoutes from "./paymentPlatformApp.routes";
import publicAssetRoutes from "./publicAsset.routes";
import contactRouter, {
  contactFormSettingsRouter,
} from "./contactForm.routes";
import recaptchaCredentialsRoutes from "./recaptchaCredentials.routes";

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
router.use("/schedule", scheduleRoutes);
router.use("/customers", customerRoutes);
router.use("/contracts", contractRoutes);
router.use("/contract-templates", contractTemplateRoutes);
router.use("/twilio-accounts", twilioAccountRoutes);
router.use("/email-accounts", emailAccountRoutes);
router.use("/google-credentials", googleCredentialsRoutes);
router.use("/recaptcha-credentials", recaptchaCredentialsRoutes);
router.use("/message-templates", messageTemplateRoutes);
router.use("/messaging", messagingRoutes);
router.use("/notifications", notificationRoutes);
router.use("/payment-provider-accounts", paymentProviderAccountRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/products", productRoutes);
router.use("/manufacturers", manufacturerRoutes);
router.use("/estimates", estimateRoutes);
router.use("/financials", financialsRoutes);
router.use("/pay", payLinkRoutes);
router.use("/cloudinary-credentials", cloudinaryCredentialsRoutes);
router.use("/payment-platform-apps", paymentPlatformAppRoutes);
router.get("/public-assets/:slug/health", publicAssetHealth);
router.get("/public-assets/:slug", getPublicAssetBySlug);
router.use("/public-assets", publicAssetRoutes);
router.use("/contact", contactRouter);
router.use("/contact-form-settings", contactFormSettingsRouter);

export default router;
