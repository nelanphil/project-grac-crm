import { Router, Request, Response } from "express";
import {
  PAYMENT_PROVIDERS,
  PaymentProviderName,
} from "../models/mongo/PaymentProviderAccount";
import { getAdapter } from "../payments/registry";
import { getPaymentProviderAccountsForWebhook } from "../services/paymentProvider.service";
import {
  findInvoiceForWebhook,
  markInvoicePaid,
} from "../services/invoice.service";

const router = Router();

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

    const invoice = await findInvoiceForWebhook({
      invoiceId: verified.invoiceId,
      providerOrderId: verified.providerOrderId,
      providerPaymentId: verified.providerPaymentId,
    });

    if (!invoice) {
      res.status(200).json({ ok: true, unmatched: true });
      return;
    }

    if (verified.status === "paid") {
      await markInvoicePaid({
        invoice,
        providerPaymentId: verified.providerPaymentId,
        providerOrderId: verified.providerOrderId,
      });
    } else if (verified.status === "failed" && invoice.status !== "paid") {
      invoice.status = "failed";
      await invoice.save();
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[payments webhook]", err);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

export default router;
