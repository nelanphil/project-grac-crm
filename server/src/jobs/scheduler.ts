import cron from "node-cron";
import { runRenewalInvoiceJob } from "./renewalInvoices";

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

  console.log("[renewal-invoices] scheduler started (daily 06:00)");
}
