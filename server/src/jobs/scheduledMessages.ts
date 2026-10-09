import { dispatchMessagingBatch } from "../controllers/messaging.controller";
import { ScheduledMessageSend } from "../models/mongo/ScheduledMessageSend";
import { resolvePublicApiBase } from "../utils/publicUrl";

const MAX_PER_TICK = 3;

let draining = false;

export async function runScheduledMessageJob(): Promise<{
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
      const row = await ScheduledMessageSend.findOneAndUpdate(
        { status: "scheduled", scheduledAt: { $lte: new Date() } },
        { $set: { status: "sending", errorMessage: null } },
        { sort: { scheduledAt: 1 }, new: true },
      );
      if (!row) break;

      claimed += 1;
      try {
        const result = await dispatchMessagingBatch(
          {
            contactIds: row.contactIds,
            body: row.body,
            templateId: row.templateRef ? String(row.templateRef) : undefined,
            twilioAccountId: String(row.twilioAccountRef),
            fromNumber: row.fromNumber,
            mediaUrls: row.mediaUrls ?? [],
            renewalYear: row.renewalYear ?? undefined,
            renewalMonth: row.renewalMonth ?? undefined,
            includePaymentLink: row.includePaymentLink,
            offerContractTemplateId: row.offerContractTemplateId
              ? String(row.offerContractTemplateId)
              : null,
            offerContractOverrides: (row.offerContractOverrides ?? []).map(
              (override) => ({
                contactId: override.contactId,
                contractTemplateId: override.contractTemplateId
                  ? String(override.contractTemplateId)
                  : null,
              }),
            ),
          },
          {
            userId: row.createdByUserRef ? String(row.createdByUserRef) : null,
            apiBase: resolvePublicApiBase(),
          },
        );
        row.status = "sent";
        row.summary = result.summary;
        row.errorMessage = null;
        await row.save();
        sent += 1;
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to send scheduled message";
        row.status = "failed";
        row.errorMessage = errorMessage;
        await row.save();
        failed += 1;
        console.error(
          `[scheduled-messages] campaign ${String(row._id)} failed`,
          err,
        );
      }
    }
  } finally {
    draining = false;
  }

  return { claimed, sent, failed, skipped: false };
}
