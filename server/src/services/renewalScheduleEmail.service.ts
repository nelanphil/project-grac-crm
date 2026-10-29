import { Types } from "mongoose";
import { env } from "../config/env";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { isEmailChannelEnabled } from "../utils/emailPreferences";
import { applyInvoiceTokens } from "../utils/automatedMessageCopy";
import { listUnsubscribeHeaders } from "../utils/unsubscribeToken";
import { mintPayToken } from "../utils/payToken";
import { formatLocalDate } from "../utils/scheduleTime";
import {
  automatedEmailPauseReasonFor,
  getRenewalScheduleOptions,
  resolveAutomatedMessage,
} from "./automatedMessage.service";
import { sendRoleEmail } from "./email.service";
import {
  loadInvoiceEmailContext,
  renderAutomatedBillingEmail,
} from "./paymentReceipt.service";
import {
  CONTRACT_SERVICE_SOURCE_TYPES,
  ensureRenewalWorkOrder,
  isContractServiceInvoice,
  renewalVisitState,
} from "./renewalWorkOrder.service";
import {
  recommendedDatesEmailHtml,
  recommendedDatesEmailText,
} from "./renewalScheduleChoice";
import { recommendDatesForSite } from "./schedule.service";

const OFFERED_DATE_LIMIT = 3;

export type RenewalScheduleEmailResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

function schedulePageUrl(): string {
  return `${env.clientUrl.replace(/\/$/, "")}/schedule-renewal`;
}

async function releaseScheduleClaim(invoiceId: Types.ObjectId): Promise<void> {
  await Invoice.updateOne(
    { _id: invoiceId },
    { $set: { renewalScheduleEmailSentAt: null } },
  );
}

async function offeredDatesFor(workOrderId: string | null): Promise<string[]> {
  if (!workOrderId || !Types.ObjectId.isValid(workOrderId)) return [];
  const workOrder = await WorkOrder.findById(workOrderId)
    .select(
      "addressRef customerAddress customerCity customerState customerZip workOrderTypeRef estimatedMinutes",
    )
    .lean();
  if (!workOrder) return [];
  try {
    const recommended = await recommendDatesForSite({
      addressRef: workOrder.addressRef ? String(workOrder.addressRef) : undefined,
      address: workOrder.customerAddress || undefined,
      city: workOrder.customerCity || undefined,
      state: workOrder.customerState || undefined,
      zip: workOrder.customerZip || undefined,
      workOrderTypeRef: workOrder.workOrderTypeRef
        ? String(workOrder.workOrderTypeRef)
        : undefined,
      estimatedMinutes: workOrder.estimatedMinutes || undefined,
      excludeWorkOrderId: String(workOrder._id),
    });
    const dates: string[] = [];
    const today = formatLocalDate(new Date());
    for (const row of recommended.dates) {
      if (!row.date || row.date < today || dates.includes(row.date)) continue;
      dates.push(row.date);
      if (dates.length >= OFFERED_DATE_LIMIT) break;
    }
    return dates;
  } catch (err) {
    console.error("[renewal-schedule] date recommendation failed", err);
    return [];
  }
}

async function deliver(
  invoice: IInvoice,
  options?: { force?: boolean },
): Promise<RenewalScheduleEmailResult> {
  const fresh = await Invoice.findById(invoice._id);
  if (!fresh || fresh.status !== "paid" || !isContractServiceInvoice(fresh.sourceType)) {
    return { status: "skipped", reason: "Not a paid contract invoice." };
  }

  const paused = await automatedEmailPauseReasonFor("renewalScheduleEmail");
  if (paused) return { status: "skipped", reason: paused };

  const settings = await getRenewalScheduleOptions();

  const { recipient } = await loadInvoiceEmailContext(fresh);
  if (!recipient) {
    return { status: "skipped", reason: "No billing email for this customer." };
  }
  if (!(await isEmailChannelEnabled(recipient, "billing"))) {
    return { status: "skipped", reason: "Billing alerts are off for this customer." };
  }

  const visit = await renewalVisitState(fresh);
  if (visit.scheduled) {
    return { status: "skipped", reason: "This renewal visit is already scheduled." };
  }

  if (options?.force) {
    await releaseScheduleClaim(fresh._id as Types.ObjectId);
  }
  const claimed = await Invoice.findOneAndUpdate(
    {
      _id: fresh._id,
      status: "paid",
      sourceType: { $in: [...CONTRACT_SERVICE_SOURCE_TYPES] },
      renewalScheduleEmailSentAt: null,
    },
    { $set: { renewalScheduleEmailSentAt: new Date() } },
  );
  if (!claimed) {
    return { status: "skipped", reason: "This scheduling email was already sent." };
  }

  try {
    let workOrderId = fresh.serviceWorkOrderRef
      ? String(fresh.serviceWorkOrderRef)
      : "";
    if (!workOrderId) {
      const created = await ensureRenewalWorkOrder(fresh);
      workOrderId = created?.workOrderId ?? "";
    }

    const dates = settings.offerRecommendedDates
      ? await offeredDatesFor(workOrderId || null)
      : [];
    let recommendedDates: { html: string; text: string } | null = null;
    if (dates.length > 0) {
      const minted = mintPayToken();
      const offered = {
        pageUrl: schedulePageUrl(),
        token: minted.token,
        dates,
      };
      recommendedDates = {
        html: recommendedDatesEmailHtml(offered),
        text: recommendedDatesEmailText(offered),
      };
      await Invoice.updateOne(
        { _id: fresh._id },
        {
          $set: {
            renewalScheduleTokenHash: minted.hash,
            renewalScheduleTokenExpiresAt: minted.expiresAt,
            renewalScheduleOfferedDates: dates,
          },
        },
      );
    }

    const label =
      typeof fresh.metadata?.templateLabel === "string"
        ? fresh.metadata.templateLabel.trim()
        : "";
    const copy = await resolveAutomatedMessage("renewalScheduleEmail", {
      number: fresh.number,
      amountCents: fresh.amountCents,
      dueDate: fresh.dueDate,
      record: fresh,
    });
    const tokens = {
      number: fresh.number,
      amountCents: fresh.amountCents,
      dueDate: fresh.dueDate,
      contractType: label || "service",
    };
    const rendered = await renderAutomatedBillingEmail({
      subject: applyInvoiceTokens(copy.subject, tokens),
      body: applyInvoiceTokens(copy.body, tokens),
      emailChrome: copy.emailChrome,
      invoiceId: String(fresh._id),
      customerRef: fresh.customerRef,
      recipient,
      recommendedDates,
    });
    await sendRoleEmail("billing_notifications", {
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: listUnsubscribeHeaders(recipient, "billing"),
    });
    return { status: "sent" };
  } catch (err) {
    await releaseScheduleClaim(fresh._id as Types.ObjectId);
    const error = err instanceof Error ? err.message : "The email was not sent.";
    return { status: "failed", error };
  }
}

/** Follow-up after a paid ASC renewal. Never throws; payment stays paid. */
export async function sendRenewalScheduleEmail(
  invoice: IInvoice,
  options?: { force?: boolean },
): Promise<RenewalScheduleEmailResult> {
  try {
    return await deliver(invoice, options);
  } catch (err) {
    console.error(
      `[renewal-schedule] Failed for invoice ${invoice.number}:`,
      err,
    );
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The email was not sent.",
    };
  }
}
