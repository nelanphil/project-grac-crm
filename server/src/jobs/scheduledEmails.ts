import {
  ScheduledEmailSend,
} from "../models/mongo/ScheduledEmailSend";
import { dispatchStaffEmailBatch } from "../services/emailMessage.service";

const MAX_PER_TICK = 3;

let draining = false;

export async function runScheduledEmailJob(): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  skipped: boolean;
}> {
  if (draining) {
    return { claimed: 0, sent: 0, failed: 0, skipped: true };
  }
  draining = true;

  let claimed = 0;
  let sent = 0;
  let failed = 0;

  try {
    for (let i = 0; i < MAX_PER_TICK; i += 1) {
      const row = await ScheduledEmailSend.findOneAndUpdate(
        { status: "scheduled", scheduledAt: { $lte: new Date() } },
        { $set: { status: "sending", errorMessage: null } },
        { sort: { scheduledAt: 1 }, new: true },
      );
      if (!row) break;

      claimed += 1;
      try {
        const result = await dispatchStaffEmailBatch({
          contactIds: row.contactIds,
          subject: row.subject,
          body: row.body,
          emailChrome: row.emailChrome ?? undefined,
          templateId: row.templateRef ? String(row.templateRef) : null,
          emailAccountId: String(row.emailAccountRef),
          fromName: row.fromName,
          replyTo: row.replyTo,
          emailsPerSecond: row.emailsPerSecond,
          renewalYear: row.renewalYear,
          renewalMonth: row.renewalMonth,
          includePaymentLink: row.includePaymentLink,
          createdByUserId: row.createdByUserRef
            ? String(row.createdByUserRef)
            : null,
        });
        row.status = "sent";
        row.summary = result.summary;
        row.errorMessage = null;
        await row.save();
        sent += 1;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to send scheduled email";
        row.status = "failed";
        row.errorMessage = errorMessage;
        await row.save();
        failed += 1;
        console.error(
          `[scheduled-emails] campaign ${String(row._id)} failed`,
          err,
        );
      }
    }
  } finally {
    draining = false;
  }

  return { claimed, sent, failed, skipped: false };
}
