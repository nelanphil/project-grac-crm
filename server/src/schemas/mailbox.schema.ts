import { z } from "zod";

export const mailboxFolderSchema = z.enum(["inbox", "sent"]);

const emailAddress = z.string().trim().email().max(320);

export const mailboxListQuerySchema = z.object({
  folder: mailboxFolderSchema,
  limit: z.coerce.number().int().min(1).max(50).optional().default(50),
});

export const mailboxMessageQuerySchema = z.object({
  folder: mailboxFolderSchema,
});

export const mailboxReplySchema = z.object({
  folder: mailboxFolderSchema,
  mode: z.enum(["reply", "replyAll", "forward"]),
  to: z.array(emailAddress).min(1).max(50),
  cc: z.array(emailAddress).max(50).optional().default([]),
  bcc: z.array(emailAddress).max(50).optional().default([]),
  subject: z.string().trim().min(1).max(300),
  html: z.string().max(100_000),
});

export const mailboxAssigneesSchema = z.object({
  folder: mailboxFolderSchema,
  userIds: z.array(z.string().trim().min(1)).max(20),
});
