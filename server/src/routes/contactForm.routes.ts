import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { contactRateLimit } from "../middleware/contactRateLimit";
import {
  getContactFormSettings,
  saveContactFormSettings,
  submitContactForm,
} from "../controllers/contactForm.controller";

const contactRouter = Router();
contactRouter.post("/", contactRateLimit, submitContactForm);

const contactFormSettingsRouter = Router();
contactFormSettingsRouter.use(authenticate);
contactFormSettingsRouter.use(requireRole("super-admin"));
contactFormSettingsRouter.get("/", getContactFormSettings);
contactFormSettingsRouter.put("/", saveContactFormSettings);

export { contactFormSettingsRouter };
export default contactRouter;
