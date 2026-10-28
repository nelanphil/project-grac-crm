import { Router, Request, Response } from "express";
import {
  PAYMENT_PROVIDERS,
  PaymentProviderName,
} from "../models/mongo/PaymentProviderAccount";
import type { IInvoice } from "../models/mongo/Invoice";
import { getAdapter } from "../payments/registry";
import type { VerifiedWebhookPayment } from "../payments/types";
import { getPaymentProviderAccountsForWebhook } from "../services/paymentProvider.service";
import { findInvoicesForWebhook } from "../services/invoice.service";
import { settleInvoicePayment } from "../services/invoiceSettlement.service";
import { reconcileOpenPosCharges } from "../services/posReconcile.service";
import { resolvePublicApiBase } from "../utils/publicUrl";

const router = Router();

/**
 * A Tap to Pay invoice matched only by order or payment ID must agree on the amount;
 * invoices named in the payment note were already chosen by our checkout.
 */
function paymentMatchesInvoice(
  invoice: IInvoice,
  verified: VerifiedWebhookPayment,
): boolean {
  if (!invoice.posCharge) return true;
  const named = (verified.invoiceIds ?? []).includes(String(invoice._id)) ||
    verified.invoiceId === String(invoice._id);
  if (named || verified.amountCents == null) return true;
  if (verified.amountCents !== invoice.amountCents) return false;
  return !verified.locationId || verified.locationId === invoice.posCharge.locationId;
}

router.post("/:provider", async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as PaymentProviderName;
    if (!PAYMENT_PROVIDERS.includes(provider)) {
      res.status(404).json({ message: "Unknown payment provider" });
      return;
    }

    const accounts = await getPaymentProviderAccountsForWebhook(provider);
    if (accounts.length === 0) {
      res.status(400).json({ message: "No active accounts for provider" });
      return;
    }

    const adapter = getAdapter(provider);
    const verified = await adapter.verifyWebhook(req, accounts);
    if (!verified) {
      res.status(401).json({ message: "Invalid webhook signature" });
      return;
    }

    if (verified.status === "ignored") {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const invoices = await findInvoicesForWebhook({
      invoiceId: verified.invoiceId,
      invoiceIds: verified.invoiceIds,
      providerOrderId: verified.providerOrderId,
      providerPaymentId: verified.providerPaymentId,
    });

    if (invoices.length === 0) {
      if (verified.status === "paid" && verified.amountCents != null) {
        await reconcileOpenPosCharges({
          amountCents: verified.amountCents,
          locationId: verified.locationId,
          apiBase: resolvePublicApiBase(req),
        }).catch((err) => console.error("[payments webhook] pos reconcile", err));
      }
      res.status(200).json({ ok: true, unmatched: true });
      return;
    }

    if (verified.status === "paid") {
      const payable = invoices.filter((invoice) =>
        paymentMatchesInvoice(invoice, verified),
      );
      await settleInvoicePayment({
        invoices: payable,
        providerPaymentId: verified.providerPaymentId,
        providerOrderId: verified.providerOrderId,
        paidByCustomer: true,
        apiBase: resolvePublicApiBase(req),
      });
    } else if (verified.status === "failed") {
      for (const invoice of invoices) {
        if (invoice.status !== "paid") {
          invoice.status = "failed";
          await invoice.save();
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[payments webhook]", err);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

export default router;
