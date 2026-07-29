import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import { SquareClient, SquareEnvironment, WebhooksHelper } from "square";
import { Request } from "express";
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderAdapter,
  VerifiedWebhookPayment,
} from "./types";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";

function squareClient(account: PaymentAccountWithSecrets): SquareClient {
  const token = account.secrets.accessToken;
  if (!token) {
    throw new Error("Square access token is not configured");
  }
  if (!account.account.locationId) {
    throw new Error("Square location ID is not configured");
  }

  return new SquareClient({
    token,
    environment:
      account.account.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}

async function verifySquareSignature(
  req: Request,
  signatureKey: string,
  notificationUrl: string,
): Promise<boolean> {
  const signature = req.header("x-square-hmacsha256-signature");
  if (!signature || !signatureKey) return false;

  const body =
    Buffer.isBuffer((req as Request & { rawBody?: Buffer }).rawBody)
      ? (req as Request & { rawBody: Buffer }).rawBody.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : JSON.stringify(req.body ?? {});

  try {
    return await WebhooksHelper.verifySignature({
      requestBody: body,
      signatureHeader: signature,
      signatureKey,
      notificationUrl,
    });
  } catch {
    const hmac = createHmac("sha256", signatureKey);
    hmac.update(notificationUrl + body);
    return hmac.digest("base64") === signature;
  }
}

export const squareAdapter: PaymentProviderAdapter = {
  name: "square",

  async createCheckout(
    input: CreateCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    const { invoice, account, redirectUrl } = input;
    const client = squareClient(account);
    const locationId = account.account.locationId!;

    const name =
      invoice.lineItems[0]?.description || `Invoice ${invoice.number}`;

    const response = await client.checkout.paymentLinks.create({
      idempotencyKey: randomUUID(),
      description: `Invoice ${invoice.number}`,
      quickPay: {
        name,
        priceMoney: {
          amount: BigInt(invoice.amountCents),
          currency: (invoice.currency || "USD") as "USD",
        },
        locationId,
      },
      paymentNote: `invoice:${invoice._id}`,
      checkoutOptions: {
        redirectUrl,
        askForShippingAddress: false,
      },
    });

    const link = response.paymentLink;
    if (!link?.url || !link.id) {
      throw new Error("Square did not return a payment link");
    }

    return {
      url: link.url,
      checkoutId: link.id,
      orderId: link.orderId,
    };
  },

  async verifyWebhook(
    req: Request,
    accounts: PaymentAccountWithSecrets[],
  ): Promise<VerifiedWebhookPayment | null> {
    const notificationUrl =
      `${req.protocol}://${req.get("host")}${req.originalUrl}`.split("?")[0];

    let matched: PaymentAccountWithSecrets | null = null;
    for (const account of accounts) {
      const key = account.secrets.webhookSignatureKey;
      if (!key) continue;
      if (await verifySquareSignature(req, key, notificationUrl)) {
        matched = account;
        break;
      }
    }

    if (!matched) {
      const sandboxWithoutKey = accounts.find(
        (a) =>
          a.account.environment === "sandbox" &&
          !a.secrets.webhookSignatureKey,
      );
      if (sandboxWithoutKey && process.env.NODE_ENV !== "production") {
        matched = sandboxWithoutKey;
      } else {
        return null;
      }
    }

    const rawBody =
      Buffer.isBuffer((req as Request & { rawBody?: Buffer }).rawBody)
        ? JSON.parse(
            (req as Request & { rawBody: Buffer }).rawBody.toString("utf8"),
          )
        : typeof req.body === "string"
          ? JSON.parse(req.body)
          : Buffer.isBuffer(req.body)
            ? JSON.parse(req.body.toString("utf8"))
            : req.body;

    const type = rawBody?.type as string | undefined;
    const data = rawBody?.data?.object;

    if (type === "payment.updated" || type === "payment.created") {
      const payment = data?.payment;
      const status = String(payment?.status || "").toUpperCase();
      const note = String(payment?.note || "");
      const invoiceIdMatch = note.match(/invoice:([a-f0-9]{24})/i);

      if (status === "COMPLETED") {
        return {
          status: "paid",
          providerPaymentId: payment?.id,
          providerOrderId: payment?.orderId,
          invoiceId: invoiceIdMatch?.[1],
          raw: rawBody,
        };
      }
      if (status === "FAILED" || status === "CANCELED") {
        return {
          status: "failed",
          providerPaymentId: payment?.id,
          providerOrderId: payment?.orderId,
          invoiceId: invoiceIdMatch?.[1],
          raw: rawBody,
        };
      }
    }

    if (type === "order.updated") {
      const order = data?.order;
      const state = String(order?.state || "").toUpperCase();
      if (state === "COMPLETED") {
        return {
          status: "paid",
          providerOrderId: order?.id,
          raw: rawBody,
        };
      }
    }

    return { status: "ignored", raw: rawBody };
  },
};
