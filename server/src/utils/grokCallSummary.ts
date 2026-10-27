import { z } from "zod";

const grokCallSummarySchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  task: z.object({
    needed: z.boolean(),
    title: z.string().trim().max(200).default(""),
    description: z.string().trim().max(4000).default(""),
    dueInDays: z.number().int().min(0).max(365).nullable().default(null),
  }),
});

export type GrokCallSummary = z.infer<typeof grokCallSummarySchema>;

export function parseGrokCallSummary(raw: string): GrokCallSummary | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = grokCallSummarySchema.safeParse(parsed);
  return result.success ? result.data : null;
}
