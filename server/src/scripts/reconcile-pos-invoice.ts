/**
 * Finds the Square payment behind a Tap to Pay charge the CRM never recorded, and marks
 * the invoice paid (sending the customer receipt) when one payment clearly matches.
 *
 * Dry run: npx tsx src/scripts/reconcile-pos-invoice.ts --work-order WO-2026-00077
 * Apply:   npx tsx src/scripts/reconcile-pos-invoice.ts --work-order WO-2026-00077 --apply
 *
 * Options:
 *   --invoice <number>        Invoice number instead of a work order number.
 *   --since <ISO datetime>    When Tap to Pay was started; searches the next 2 hours.
 *                             Defaults to the recorded charge, else the invoice's updatedAt.
 *   --transaction <id>        Square order or payment ID, when known.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { reconcilePosCharge } from "../services/posReconcile.service";

const APPLY = process.argv.includes("--apply");

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1]?.trim() ?? "";
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

function money(cents: number | undefined): string {
  return cents == null ? "?" : `$${(cents / 100).toFixed(2)}`;
}

async function findInvoice(): Promise<IInvoice> {
  const invoiceNumber = argValue("--invoice");
  if (invoiceNumber) {
    const invoice = await Invoice.findOne({ number: invoiceNumber });
    if (!invoice) throw new Error(`Invoice ${invoiceNumber} not found`);
    return invoice;
  }
  const workOrderNumber = argValue("--work-order");
  if (!workOrderNumber) throw new Error("Pass --work-order <number> or --invoice <number>");
  const workOrder = await WorkOrder.findOne({ number: workOrderNumber }).select("_id paid");
  if (!workOrder) throw new Error(`Work order ${workOrderNumber} not found`);
  const invoices = await Invoice.find({
    workOrderRef: workOrder._id,
    status: { $ne: "void" },
  }).sort({ createdAt: -1 });
  const open = invoices.find((invoice) => invoice.status !== "paid");
  const invoice = open ?? invoices[0];
  if (!invoice) throw new Error(`Work order ${workOrderNumber} has no invoice`);
  return invoice;
}

async function main() {
  await connectMongoDB();
  const invoice = await findInvoice();
  const since = argValue("--since");
  const startedAt = since ? new Date(since) : undefined;
  if (startedAt && Number.isNaN(startedAt.getTime())) {
    throw new Error("--since must be an ISO date and time");
  }
  const transactionId = argValue("--transaction");
  if (transactionId) {
    invoice.posCharge = {
      ...(invoice.posCharge ?? {
        startedAt: startedAt ?? invoice.updatedAt,
        locationId: "",
        amountCents: invoice.amountCents,
      }),
      transactionId,
      status: "pending",
    };
  }

  console.log(
    `Invoice ${invoice.number} · ${money(invoice.amountCents)} · ${invoice.status}` +
      (invoice.posCharge
        ? ` · Tap to Pay ${invoice.posCharge.status} since ${invoice.posCharge.startedAt.toISOString()}`
        : " · no recorded Tap to Pay charge"),
  );

  const outcome = await reconcilePosCharge(invoice, {
    apply: APPLY,
    startedAt,
    actor: { actorType: "system", actorName: "Square sync script" },
  });

  switch (outcome.status) {
    case "paid":
    case "would_pay": {
      const p = outcome.payment;
      console.log(
        `${outcome.status === "paid" ? "Marked paid" : "Would mark paid"} with Square payment ` +
          `${p.providerPaymentId ?? "?"} (order ${p.providerOrderId ?? "?"}) · ` +
          `${money(p.amountCents)} · ${p.createdAt ?? ""}`,
      );
      if (outcome.status === "would_pay") console.log("Dry run. Re-run with --apply.");
      break;
    }
    case "needs_review":
      console.log(`Needs review: ${outcome.reason}`);
      for (const p of outcome.candidates) {
        console.log(
          `  candidate ${p.providerPaymentId} · ${money(p.amountCents)} · ${p.createdAt ?? ""} · note "${p.note ?? ""}"`,
        );
      }
      console.log("Pass --transaction <id> with the right Square payment to settle it.");
      break;
    case "skipped":
      console.log(`Skipped: ${outcome.reason}`);
      break;
    default:
      console.log(
        `Square status: ${outcome.status}. Try --since with the time Tap to Pay was taken.`,
      );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoDB());
