export const CONTACT_FORM_SUBJECT_PREFIX = "Website contact from ";

export type ParsedContactFormNotification = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
};

function field(text: string, label: string): string | null {
  const match = text.match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
  return match ? match[1].trim() : null;
}

/** Parse the plain-text body produced by buildContactFormEmail. */
export function parseContactFormNotification(input: {
  subject: string;
  text: string;
}): ParsedContactFormNotification | null {
  const subject = input.subject.replace(/\s+/g, " ").trim();
  if (
    !subject.toLowerCase().startsWith(CONTACT_FORM_SUBJECT_PREFIX.toLowerCase())
  ) {
    return null;
  }

  const text = input.text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  const name = field(text, "Name");
  const email = field(text, "Email");
  const phoneRaw = field(text, "Phone");
  const messageMatch = text.match(
    /Message:\s*\n([\s\S]*?)\n\s*Reply to this email to respond to the sender\./i,
  );
  if (!name || !email || !messageMatch) return null;

  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  const message = messageMatch[1].trim();
  if (!firstName || !lastName || !email.includes("@") || !message) return null;

  const phone =
    !phoneRaw || phoneRaw.toLowerCase() === "(not provided)" ? "" : phoneRaw;

  return { firstName, lastName, email, phone, message };
}
