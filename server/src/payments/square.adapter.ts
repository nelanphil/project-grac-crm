import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import { SquareClient, SquareEnvironment, WebhooksHelper } from "square";
import { Request } from "express";
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderAdapter,
  RetrievedProviderPayment,
  VerifiedWebhookPayment,
} from "./types";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";
import { parseInvoiceIdsFromPaymentNote } from "../utils/paymentLinkForCustomer";

function squareClientForToken(account: PaymentAccountWithSecrets): SquareClient {
  const token = account.secrets.accessToken;
  if (!token) {
    throw new Error("Square access token is not configured");
  }

  return new SquareClient({
    token,
    environment:
      account.account.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}

function squareClient(account: PaymentAccountWithSecrets): SquareClient {
  if (!account.account.locationId) {
    throw new Error("Square location ID is not configured");
  }
  return squareClientForToken(account);
}

function mapSquarePaymentStatus(
  status: string,
): RetrievedProviderPayment["status"] {
  const normalized = status.toUpperCase();
  if (normalized === "COMPLETED") return "paid";
  if (normalized === "FAILED" || normalized === "CANCELED") return "failed";
  return "pending";
}

function mapSquareOrderState(
  state: string,
): RetrievedProviderPayment["status"] {
  const normalized = state.toUpperCase();
  if (normalized === "COMPLETED") return "paid";
  if (normalized === "CANCELED") return "failed";
  return "pending";
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

  async retrievePayment(
    account: PaymentAccountWithSecrets,
    paymentId: string,
  ): Promise<RetrievedProviderPayment | null> {
    const client = squareClientForToken(account);
    const response = await client.payments.get({ paymentId });
    const payment = response.payment;
    if (!payment?.id) return null;
    const note = String(payment.note || "");
    return {
      status: mapSquarePaymentStatus(String(payment.status || "")),
      providerPaymentId: payment.id,
      providerOrderId: payment.orderId,
      invoiceIds: parseInvoiceIdsFromPaymentNote(note),
      note,
    };
  },

  async retrieveOrder(
    account: PaymentAccountWithSecrets,
    orderId: string,
  ): Promise<RetrievedProviderPayment | null> {
    const client = squareClientForToken(account);
    const response = await client.orders.get({ orderId });
    const order = response.order;
    if (!order?.id) return null;

    const notes = [
      order.metadata?.paymentNote,
      ...(order.tenders ?? []).map((tender) => tender.note),
    ].filter((value): value is string => Boolean(value));
    const invoiceIds = [
      ...new Set(notes.flatMap((note) => parseInvoiceIdsFromPaymentNote(note))),
    ];
    const note = notes[0] || "";

    const stateStatus = mapSquareOrderState(String(order.state || ""));
    if (stateStatus !== "pending") {
      return {
        status: stateStatus,
        providerOrderId: order.id,
        invoiceIds,
        note,
      };
    }

    // Payment Links often leave the order OPEN after a completed card charge.
    let pending: RetrievedProviderPayment | null = null;
    for (const tender of order.tenders ?? []) {
      const paymentId = tender.paymentId;
      if (!paymentId) continue;
      try {
        const paymentResponse = await client.payments.get({ paymentId });
        const payment = paymentResponse.payment;
        if (!payment?.id) continue;
        const paymentNote = String(payment.note || tender.note || note);
        const retrieved: RetrievedProviderPayment = {
          status: mapSquarePaymentStatus(String(payment.status || "")),
          providerPaymentId: payment.id,
          providerOrderId: order.id,
          invoiceIds: [
            ...new Set([
              ...invoiceIds,
              ...parseInvoiceIdsFromPaymentNote(paymentNote),
            ]),
          ],
          note: paymentNote,
        };
        if (retrieved.status === "paid") return retrieved;
        if (retrieved.status === "failed") return retrieved;
        pending = retrieved;
      } catch {
        // Try the next tender if Square has not indexed this payment yet.
      }
    }

    return (
      pending ?? {
        status: "pending",
        providerOrderId: order.id,
        invoiceIds,
        note,
      }
    );
  },
};
