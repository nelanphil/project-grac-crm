import { SMS_BODY_MAX } from "../schemas/messageTemplate.schema";
import {
  renderMessageTemplate,
  templateUsesPaymentLink,
  type MessageTemplateContext,
} from "./messageTemplate";

export type SmsPaymentBody = {
  body: string;
  error?: string;
};

/**
 * Substitute {{payment_link}} with the short URL. When the include checkbox
 * is on and the token is absent, append a Pay line. Overflow fails the send.
 */
export function composeSmsPaymentBody(input: {
  bodyTemplate: string;
  context: MessageTemplateContext;
  includePaymentLink: boolean;
  paymentUrl: string | null;
}): SmsPaymentBody {
  const usesToken = templateUsesPaymentLink(input.bodyTemplate);
  const context: MessageTemplateContext = {
    ...input.context,
    payment_link: input.paymentUrl ?? "",
  };
  let body = renderMessageTemplate(input.bodyTemplate, context);
  if (input.includePaymentLink && !usesToken && input.paymentUrl) {
    const line = `Pay: ${input.paymentUrl}`;
    body = body.trim() ? `${body.replace(/\s+$/, "")}\n${line}` : line;
  }
  if (body.length > SMS_BODY_MAX) {
    return {
      body,
      error: `Message exceeds ${SMS_BODY_MAX} characters after adding the payment link`,
    };
  }
  return { body };
}
