import { z } from "zod";
import {
  JOURNEY_ENTRIES,
  JOURNEY_EVENT_TYPES,
} from "../models/mongo/PaymentJourneySession";
import { JOURNEY_SNAPSHOT_MAX_BYTES } from "../models/mongo/PaymentJourneySnapshot";

export const JOURNEY_BATCH_LIMIT = 50;

const token = z.string().trim().min(1).max(200);

export const journeyEventSchema = z.object({
  t: z.number().int().positive(),
  type: z.enum(JOURNEY_EVENT_TYPES),
  detail: z.string().max(2000).default(""),
  meta: z
    .object({
      status: z.number().int().optional(),
      durationMs: z.number().nonnegative().optional(),
      message: z.string().max(2000).optional(),
    })
    .optional(),
});

const journeySessionId = z.string().trim().regex(/^[A-Za-z0-9_-]{16,64}$/);

const journeyLinkSchema = z
  .object({
    checkoutKey: token.optional(),
    payCode: token.optional(),
    payToken: token.optional(),
    viewToken: token.optional(),
    invoiceId: z.string().trim().regex(/^[a-f0-9]{24}$/i).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.checkoutKey ||
          value.payCode ||
          value.payToken ||
          value.viewToken ||
          value.invoiceId,
      ),
    { message: "A payment link reference is required" },
  );

export const journeyBatchSchema = z.object({
  sessionId: journeySessionId,
  entry: z.enum(JOURNEY_ENTRIES),
  link: journeyLinkSchema,
  events: z.array(journeyEventSchema).max(JOURNEY_BATCH_LIMIT),
});

const JOURNEY_SNAPSHOT_MAX_BASE64 = Math.ceil(JOURNEY_SNAPSHOT_MAX_BYTES / 3) * 4;

export const journeySnapshotSchema = z.object({
  sessionId: journeySessionId,
  entry: z.enum(JOURNEY_ENTRIES),
  link: journeyLinkSchema,
  step: z.string().trim().regex(/^[a-z_]{1,60}$/),
  takenAt: z.iso.datetime(),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(16000),
  image: z
    .string()
    .min(1)
    .max(JOURNEY_SNAPSHOT_MAX_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export type JourneyBatchInput = z.infer<typeof journeyBatchSchema>;
export type JourneyEventInput = z.infer<typeof journeyEventSchema>;
export type JourneySnapshotInput = z.infer<typeof journeySnapshotSchema>;
