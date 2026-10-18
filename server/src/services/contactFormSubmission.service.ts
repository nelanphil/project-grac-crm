import { EmailAccount } from "../models/mongo/EmailAccount";
import { ContactFormSubmission } from "../models/mongo/ContactFormSubmission";
import { findContactFormMailboxMessages } from "./mailbox.service";
import { parseContactFormNotification } from "../utils/contactFormNotification";
import { logNotificationAsync } from "./notification.service";

const PREFERRED_FROM = "contact@genmaintoffl.com";

export type ContactFormImportResult = {
  imported: number;
  skipped: number;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

function prefersContactMailbox(account: {
  fromEmail?: string;
  username?: string;
}): boolean {
  const from = account.fromEmail?.trim().toLowerCase() ?? "";
  const user = account.username?.trim().toLowerCase() ?? "";
  return from === PREFERRED_FROM || user === PREFERRED_FROM;
}

export function notifyContactFormSubmission(row: {
  _id: unknown;
  firstName: string;
  lastName: string;
  createdAt?: Date;
}): void {
  const name = `${row.firstName} ${row.lastName}`.trim() || "Someone";
  logNotificationAsync({
    entityType: "contact_form",
    action: "created",
    entityId: String(row._id),
    summary: `${name} submitted the website contact form.`,
    actorType: "system",
    actorName: name,
    metadata: {
      submittedAt: (row.createdAt ?? new Date()).toISOString(),
    },
  });
}

export async function importContactFormSubmissions(): Promise<ContactFormImportResult> {
  const accounts = await EmailAccount.find({ isActive: true });
  accounts.sort((left, right) => {
    const leftRank = prefersContactMailbox(left) ? 0 : 1;
    const rightRank = prefersContactMailbox(right) ? 0 : 1;
    return leftRank - rightRank;
  });

  let imported = 0;
  let skipped = 0;
  const seenMessageIds = new Set<string>();

  for (const account of accounts) {
    let hits;
    try {
      hits = await findContactFormMailboxMessages(account);
    } catch (err) {
      console.error(
        "[contact-form] mailbox import failed:",
        account.fromEmail,
        err,
      );
      continue;
    }

    for (const hit of hits) {
      const messageId = hit.messageId.trim();
      if (messageId) {
        if (seenMessageIds.has(messageId)) {
          skipped += 1;
          continue;
        }
        seenMessageIds.add(messageId);
      }

      const parsed = parseContactFormNotification({
        subject: hit.subject,
        text: hit.text,
      });
      if (!parsed) {
        skipped += 1;
        continue;
      }

      if (messageId) {
        const byId = await ContactFormSubmission.findOne({
          providerMessageId: messageId,
        })
          .select("_id")
          .lean();
        if (byId) {
          skipped += 1;
          continue;
        }
      }

      const byBody = await ContactFormSubmission.findOne({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        message: parsed.message,
        email: {
          $regex: new RegExp(`^${escapeRegex(parsed.email)}$`, "i"),
        },
      })
        .select("_id")
        .lean();
      if (byBody) {
        skipped += 1;
        continue;
      }

      const submittedAt = hit.date ? new Date(hit.date) : new Date();
      try {
        const row = await ContactFormSubmission.create({
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          email: parsed.email,
          phone: parsed.phone,
          message: parsed.message,
          source: "mailbox-import",
          providerMessageId: messageId || undefined,
          createdAt: Number.isNaN(submittedAt.getTime())
            ? new Date()
            : submittedAt,
        });
        notifyContactFormSubmission(row);
        imported += 1;
      } catch (err) {
        if (isDuplicateKey(err)) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
  }

  return { imported, skipped };
}
