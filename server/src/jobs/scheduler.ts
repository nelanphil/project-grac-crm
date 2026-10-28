import cron from "node-cron";
import { runMailboxAutoReplyJob } from "./mailboxAutoReply";
import { runRenewalInvoiceJob } from "./renewalInvoices";
import { runTaskReminderJob } from "./taskReminders";
import { runScheduledEmailJob } from "./scheduledEmails";
import { runScheduledMessageJob } from "./scheduledMessages";
import { refreshExpiringSquareOAuthTokens } from "../services/squareOAuth.service";
import { runPosReconcileJob } from "../services/posReconcile.service";

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
    void runTaskReminderJob()
      .then((result) => {
        if (result.reminded > 0) console.log("[task-reminders]", result);
      })
      .catch((err) => {
        console.error("[task-reminders] job failed", err);
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

  cron.schedule("*/2 * * * *", () => {
    void runPosReconcileJob()
      .then((result) => {
        if (result.paid > 0 || result.review > 0) {
          console.log("[pos-reconcile]", result);
        }
      })
      .catch((err) => {
        console.error("[pos-reconcile] job failed", err);
      });
    void runMailboxAutoReplyJob()
      .then((result) => {
        if (result.sent > 0) {
          console.log("[mailbox-auto-reply]", result);
        }
      })
      .catch((err) => {
        console.error("[mailbox-auto-reply] job failed", err);
      });
  });

  cron.schedule("* * * * *", () => {
    void runScheduledEmailJob()
      .then((result) => {
        if (result.claimed > 0) {
          console.log("[scheduled-emails]", result);
        }
      })
      .catch((err) => {
        console.error("[scheduled-emails] job failed", err);
      });
    void runScheduledMessageJob()
      .then((result) => {
        if (result.claimed > 0) {
          console.log("[scheduled-messages]", result);
        }
      })
      .catch((err) => {
        console.error("[scheduled-messages] job failed", err);
      });
  });

  console.log("[renewal-invoices] scheduler started (daily 06:00)");
  console.log("[task-reminders] scheduler started (daily 06:00)");
  console.log("[square-oauth-refresh] scheduler started (every 12h)");
  console.log("[scheduled-emails] scheduler started (every minute)");
  console.log("[scheduled-messages] scheduler started (every minute)");
  console.log("[mailbox-auto-reply] scheduler started (every 2 minutes)");
  console.log("[pos-reconcile] scheduler started (every 2 minutes)");
}
