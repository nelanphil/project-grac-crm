import { z } from "zod";

export const mailboxFolderSchema = z.enum(["inbox", "sent"]);

export const mailboxListQuerySchema = z.object({
  folder: mailboxFolderSchema,
  limit: z.coerce.number().int().min(1).max(50).optional().default(50),
});

export const mailboxMessageQuerySchema = z.object({
  folder: mailboxFolderSchema,
});
