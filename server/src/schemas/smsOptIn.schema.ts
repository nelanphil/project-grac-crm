import { z } from "zod";
import { canonicalPhoneDigits } from "../utils/customerSites";

export const submitSmsOptInSchema = z
  .object({
    phone: z.string().trim().min(1).max(40),
    smsOptIn: z.literal(true, {
      error: "You must check the box to opt in to text messages",
    }),
  })
  .superRefine((data, ctx) => {
    if (!canonicalPhoneDigits(data.phone)) {
      ctx.addIssue({
        code: "custom",
        message:
          "A valid 10-digit mobile number is required to opt in to text messages",
        path: ["phone"],
      });
    }
  });
