/**
 * Thin re-exports for mail helpers. Prefer importing from
 * `services/email.service` for role-based sending.
 */
export {
  sendMail,
  sendRoleEmail,
  isRoleMailConfigured,
  getSmtpConfigForRole,
  buildPasswordResetUrl,
  buildLoginUrl,
  type SendMailOptions,
} from "../services/email.service";

import { isRoleMailConfigured } from "../services/email.service";

/** @deprecated Prefer isRoleMailConfigured("general_notifications") */
export async function isMailConfigured(): Promise<boolean> {
  return isRoleMailConfigured("general_notifications");
}
