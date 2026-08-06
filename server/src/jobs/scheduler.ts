import cron from "node-cron";
import { runRenewalInvoiceJob } from "./renewalInvoices";
import { refreshExpiringSquareOAuthTokens } from "../services/squareOAuth.service";

let started = false;

export function startRenewalInvoiceScheduler(): void {
  if (started) return;
  started = true;

  // Daily at 06:00 server local time
  cron.schedule("0 6 * * *", () => {
    void runRenewalInvoiceJob()
      .then((result) => {
        console.log("[renewal-invoices]", result);
      })
      .catch((err) => {
        console.error("[renewal-invoices] job failed", err);
      });
  });

  // Refresh Square OAuth access tokens approaching expiry (every 12 hours).
  cron.schedule("15 */12 * * *", () => {
    void refreshExpiringSquareOAuthTokens()
      .then((result) => {
        if (result.checked > 0) {
          console.log("[square-oauth-refresh]", result);
        }
      })
      .catch((err) => {
        console.error("[square-oauth-refresh] job failed", err);
      });
  });

  console.log("[renewal-invoices] scheduler started (daily 06:00)");
  console.log("[square-oauth-refresh] scheduler started (every 12h)");
}
