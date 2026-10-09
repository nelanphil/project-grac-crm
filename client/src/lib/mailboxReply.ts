import type {
  MailboxAddress,
  MailboxFolder,
  MailboxReplyMode,
} from "@/lib/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAddressList(value: string): {
  ok: string[];
  invalid: string[];
} {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const ok: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!EMAIL_RE.test(part)) {
      invalid.push(part);
      continue;
    }
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ok.push(part);
  }
  return { ok, invalid };
}

export function joinAddresses(list: string[]): string {
  return list.join(", ");
}

function dedupe(
  list: MailboxAddress[],
  exclude: Set<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const address = item.address.trim();
    const key = address.toLowerCase();
    if (!key || exclude.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

export function defaultRecipients(input: {
  mode: MailboxReplyMode;
  folder: MailboxFolder;
  from: MailboxAddress[];
  to: MailboxAddress[];
  cc: MailboxAddress[];
  ownAddress: string;
}): { to: string[]; cc: string[] } {
  if (input.mode === "forward") return { to: [], cc: [] };
  const own = input.ownAddress.trim().toLowerCase();
  const exclude = new Set(own ? [own] : []);
  const primary = input.folder === "sent" ? input.to : input.from;
  const to = dedupe(primary, exclude);
  if (input.mode === "reply") return { to, cc: [] };
  const taken = new Set([
    ...exclude,
    ...to.map((address) => address.toLowerCase()),
  ]);
  return {
    to,
    cc: dedupe([...input.from, ...input.to, ...input.cc], taken),
  };
}

export function replySubject(subject: string, mode: MailboxReplyMode): string {
  const base = subject.trim() || "(no subject)";
  if (mode === "forward") {
    return /^fwd:/i.test(base) ? base : `Fwd: ${base}`;
  }
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

export function formatAddressList(list: MailboxAddress[]): string {
  if (list.length === 0) return "Unknown";
  return list
    .map((item) =>
      item.name ? `${item.name} <${item.address}>` : item.address,
    )
    .join(", ");
}
