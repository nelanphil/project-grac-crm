import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import { Square, SquareClient, SquareEnvironment, WebhooksHelper } from "square";
import { Request } from "express";
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderAdapter,
  ProviderPaymentDetail,
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

type SquareCardError = { code?: unknown; detail?: unknown; category?: unknown };

function squarePaymentFailureReason(payment: unknown): string | undefined {
  if (!payment || typeof payment !== "object") return undefined;
  const record = payment as Record<string, unknown>;
  const card = (record.card_details ?? record.cardDetails) as
    | { errors?: SquareCardError[] }
    | undefined;
  const errors = Array.isArray(card?.errors) ? card.errors : [];
  const parts = errors
    .map((error) =>
      [error.code, error.detail]
        .filter((part): part is string => typeof part === "string" && part.trim() !== "")
        .join(": "),
    )
    .filter(Boolean);
  return parts.length > 0 ? parts.join("; ").slice(0, 500) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function squarePaymentDetail(payment: Square.Payment): ProviderPaymentDetail {
  const card = payment.cardDetails;
  return {
    squareProduct: text(payment.applicationDetails?.squareProduct),
    sourceType: text(payment.sourceType),
    entryMethod: text(card?.entryMethod),
    cardBrand: text(card?.card?.cardBrand),
    last4: text(card?.card?.last4),
    wallet: text(card?.walletType) ?? text(payment.walletDetails?.brand),
    receiptUrl: text(payment.receiptUrl),
  };
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

function centsFromMoney(
  money: { amount?: bigint | number | null } | null | undefined,
): number | undefined {
  const amount = money?.amount;
  if (amount == null) return undefined;
  const cents = typeof amount === "bigint" ? Number(amount) : amount;
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/** Amount before tip; Tap to Pay customers can add a tip on the reader. */
function centsBeforeTip(
  total: { amount?: bigint | number | null } | null | undefined,
  tip: { amount?: bigint | number | null } | null | undefined,
): number | undefined {
  const totalCents = centsFromMoney(total);
  if (totalCents === undefined) return undefined;
  return totalCents - (centsFromMoney(tip) ?? 0);
}

/** Notes that can carry our `invoice:<id>` marker, depending on how the order was made. */
function orderNotes(order: Square.Order): string[] {
  return [
    order.metadata?.paymentNote,
    ...(order.tenders ?? []).map((tender) => tender.note),
    ...(order.lineItems ?? []).map((item) => item.note),
  ].filter((value): value is string => Boolean(value));
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
        const amount = payment?.amount_money?.amount ?? payment?.amountMoney?.amount;
        return {
          status: "paid",
          providerPaymentId: payment?.id,
          providerOrderId: payment?.order_id ?? payment?.orderId,
          invoiceId: invoiceIds[0],
          invoiceIds,
          amountCents: typeof amount === "number" ? amount : undefined,
          locationId: payment?.location_id ?? payment?.locationId,
          raw: rawBody,
        };
      }
      if (status === "FAILED" || status === "CANCELED") {
        const amount = payment?.amount_money?.amount ?? payment?.amountMoney?.amount;
        return {
          status: "failed",
          providerStatus: status,
          failureReason: squarePaymentFailureReason(payment),
          providerPaymentId: payment?.id,
          providerOrderId: payment?.order_id ?? payment?.orderId,
          invoiceId: invoiceIds[0],
          invoiceIds,
          amountCents: typeof amount === "number" ? amount : undefined,
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
      amountCents: centsFromMoney(payment.amountMoney),
      locationId: payment.locationId || undefined,
      detail: squarePaymentDetail(payment),
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

    const notes = orderNotes(order);
    const invoiceIds = [
      ...new Set(notes.flatMap((note) => parseInvoiceIdsFromPaymentNote(note))),
    ];
    const note = notes[0] || "";
    const amountCents = centsBeforeTip(order.totalMoney, order.totalTipMoney);
    const taxCents = centsFromMoney(order.totalTaxMoney);
    const locationId = order.locationId || undefined;
    const tenderPaymentId =
      (order.tenders ?? []).find((tender) => tender.paymentId)?.paymentId ||
      undefined;

    const stateStatus = mapSquareOrderState(String(order.state || ""));
    if (stateStatus !== "pending") {
      return {
        status: stateStatus,
        providerPaymentId: tenderPaymentId,
        providerOrderId: order.id,
        invoiceIds,
        note,
        amountCents,
        locationId,
        taxCents,
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
          amountCents: centsFromMoney(payment.amountMoney) ?? amountCents,
          locationId: payment.locationId || locationId,
          taxCents,
          detail: squarePaymentDetail(payment),
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
        amountCents,
        locationId,
        taxCents,
      }
    );
  },

  async listPayments(account, window) {
    const client = squareClientForToken(account);
    const page = await client.payments.list({
      beginTime: window.beginTime.toISOString(),
      endTime: window.endTime.toISOString(),
      locationId: window.locationId,
      sortOrder: "ASC",
      limit: 100,
    });
    const payments: RetrievedProviderPayment[] = [];
    for await (const payment of page) {
      if (!payment.id) continue;
      const note = String(payment.note || "");
      payments.push({
        status: mapSquarePaymentStatus(String(payment.status || "")),
        providerPaymentId: payment.id,
        providerOrderId: payment.orderId || undefined,
        invoiceIds: parseInvoiceIdsFromPaymentNote(note),
        note,
        amountCents: centsFromMoney(payment.amountMoney),
        locationId: payment.locationId || undefined,
        createdAt: payment.createdAt || undefined,
        detail: squarePaymentDetail(payment),
      });
      if (payments.length >= 500) break;
    }

    // Point of Sale keeps our note on the order's line item, not on the payment.
    const orderIds = [
      ...new Set(
        payments
          .filter((p) => p.status === "paid" && p.invoiceIds.length === 0 && p.providerOrderId)
          .map((p) => p.providerOrderId as string),
      ),
    ];
    for (let i = 0; i < orderIds.length; i += 100) {
      const response = await client.orders.batchGet({
        locationId: window.locationId,
        orderIds: orderIds.slice(i, i + 100),
      });
      for (const order of response.orders ?? []) {
        const ids = orderNotes(order).flatMap((note) => parseInvoiceIdsFromPaymentNote(note));
        for (const payment of payments) {
          if (payment.providerOrderId !== order.id) continue;
          payment.invoiceIds = [...new Set([...payment.invoiceIds, ...ids])];
          payment.taxCents = centsFromMoney(order.totalTaxMoney);
        }
      }
    }
    return payments;
  },
};
