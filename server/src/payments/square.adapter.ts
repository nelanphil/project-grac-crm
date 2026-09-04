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
import { parseInvoiceIdsFromPaymentNote } from "../utils/paymentLinkForCustomer";

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

type SquarePrefill = {
  buyerEmail?: string;
  buyerPhoneNumber?: string;
  buyerAddress?: { firstName?: string; lastName?: string };
};

function buildPrefill(buyer?: CreateCheckoutInput["buyer"]): SquarePrefill {
  const prePopulatedData: SquarePrefill = {};
  if (buyer?.email) prePopulatedData.buyerEmail = buyer.email;
  if (buyer?.phoneE164) {
    prePopulatedData.buyerPhoneNumber = buyer.phoneE164;
  }
  if (buyer?.firstName || buyer?.lastName) {
    prePopulatedData.buyerAddress = {};
    if (buyer.firstName) {
      prePopulatedData.buyerAddress.firstName = buyer.firstName;
    }
    if (buyer.lastName) {
      prePopulatedData.buyerAddress.lastName = buyer.lastName;
    }
  }
  return prePopulatedData;
}

function squareErrorCodes(err: unknown): string[] {
  const errors = (err as { errors?: Array<{ code?: string }> })?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => String(e.code || "")).filter(Boolean);
}

export const squareAdapter: PaymentProviderAdapter = {
  name: "square",

  async createCheckout(
    input: CreateCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    const { invoice, account, redirectUrl, buyer } = input;
    const client = squareClient(account);
    const locationId = account.account.locationId!;
    const amountCents = input.amountCents ?? invoice.amountCents;
    const paymentNote = input.paymentNote ?? `invoice:${invoice._id}`;

    const name =
      input.checkoutName ||
      invoice.lineItems[0]?.description ||
      `Invoice ${invoice.number}`;

    const prePopulatedData = buildPrefill(buyer);

    const createLink = async (prefill: SquarePrefill) =>
      client.checkout.paymentLinks.create({
        idempotencyKey: randomUUID(),
        description:
          input.checkoutDescription || `Invoice ${invoice.number}`,
        quickPay: {
          name,
          priceMoney: {
            amount: BigInt(amountCents),
            currency: (invoice.currency || "USD") as "USD",
          },
          locationId,
        },
        paymentNote,
        checkoutOptions: {
          redirectUrl,
          askForShippingAddress: false,
        },
        ...(Object.keys(prefill).length > 0
          ? { prePopulatedData: prefill }
          : {}),
      });

    // Invalid CRM contact values must not block checkout — drop rejected
    // prefill fields and retry (phone and email can both be invalid).
    let response;
    for (;;) {
      try {
        response = await createLink(prePopulatedData);
        break;
      } catch (err) {
        const codes = squareErrorCodes(err);
        let stripped = false;
        if (
          codes.includes("INVALID_PHONE_NUMBER") &&
          prePopulatedData.buyerPhoneNumber
        ) {
          delete prePopulatedData.buyerPhoneNumber;
          stripped = true;
        }
        if (
          codes.includes("INVALID_EMAIL_ADDRESS") &&
          prePopulatedData.buyerEmail
        ) {
          delete prePopulatedData.buyerEmail;
          stripped = true;
        }
        if (!stripped) throw err;
      }
    }

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
      const invoiceIds = parseInvoiceIdsFromPaymentNote(note);

      if (status === "COMPLETED") {
        return {
          status: "paid",
          providerPaymentId: payment?.id,
          providerOrderId: payment?.orderId,
          invoiceId: invoiceIds[0],
          invoiceIds,
          raw: rawBody,
        };
      }
      if (status === "FAILED" || status === "CANCELED") {
        return {
          status: "failed",
          providerPaymentId: payment?.id,
          providerOrderId: payment?.orderId,
          invoiceId: invoiceIds[0],
          invoiceIds,
          raw: rawBody,
        };
      }
    }

    if (type === "order.updated") {
      const order = data?.order;
      const state = String(order?.state || "").toUpperCase();
      const note = String(order?.note || order?.metadata?.paymentNote || "");
      const invoiceIds = parseInvoiceIdsFromPaymentNote(note);
      if (state === "COMPLETED") {
        return {
          status: "paid",
          providerOrderId: order?.id,
          invoiceId: invoiceIds[0],
          invoiceIds,
          raw: rawBody,
        };
      }
    }

    return { status: "ignored", raw: rawBody };
  },
};
