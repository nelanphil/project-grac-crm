import { normalizeMessageId } from "./mailboxReply";

export type ThreadHeader = {
  id: string;
  messageId: string;
  inReplyTo: string;
  references?: string[];
};

export type ThreadBody = ThreadHeader & {
  text: string;
  html: string;
};

function findRoot(parent: number[], index: number): number {
  let current = index;
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]];
    current = parent[current];
  }
  return current;
}

function union(parent: number[], left: number, right: number): void {
  const rootLeft = findRoot(parent, left);
  const rootRight = findRoot(parent, right);
  if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
}

function normalizedIds(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = normalizeMessageId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function relatedMessageIds(message: {
  messageId: string;
  inReplyTo: string;
  references?: string[];
}): string[] {
  return normalizedIds([
    message.messageId,
    message.inReplyTo,
    ...(message.references ?? []),
  ]);
}

/** Bracketed and bare forms, for IMAP header search and stored provider ids. */
export function messageIdLookupValues(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of normalizedIds(ids)) {
    out.add(id);
    out.add(id.slice(1, -1));
  }
  return [...out];
}

export function threadIdSet(
  messages: { messageId: string; inReplyTo: string; references?: string[] }[],
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const id of relatedMessageIds(message)) ids.add(id);
  }
  return ids;
}

export function belongsToThread(
  message: { messageId: string; inReplyTo: string; references?: string[] },
  ids: Set<string>,
): boolean {
  return relatedMessageIds(message).some((id) => ids.has(id));
}

/**
 * Group a folder window by Message-ID / In-Reply-To / References.
 * Subject is intentionally ignored so different customers sharing a subject
 * stay separate.
 */
export function assignThreadKeys(messages: ThreadHeader[]): string[] {
  const parent = messages.map((_, index) => index);
  const byMessageId = new Map<string, number[]>();
  const byReference = new Map<string, number[]>();

  messages.forEach((message, index) => {
    for (const id of normalizedIds([message.messageId])) {
      const list = byMessageId.get(id) ?? [];
      list.push(index);
      byMessageId.set(id, list);
    }
    for (const id of normalizedIds([
      message.inReplyTo,
      ...(message.references ?? []),
    ])) {
      const list = byReference.get(id) ?? [];
      list.push(index);
      byReference.set(id, list);
    }
  });

  for (const indexes of byMessageId.values()) {
    for (let i = 1; i < indexes.length; i += 1) union(parent, indexes[0], indexes[i]);
  }
  for (const indexes of byReference.values()) {
    for (let i = 1; i < indexes.length; i += 1) union(parent, indexes[0], indexes[i]);
  }
  messages.forEach((message, index) => {
    for (const id of normalizedIds([
      message.inReplyTo,
      ...(message.references ?? []),
    ])) {
      const targets = byMessageId.get(id);
      if (!targets) continue;
      for (const target of targets) union(parent, index, target);
    }
  });

  const roots = messages.map((_, index) => findRoot(parent, index));
  const keyByRoot = new Map<number, string>();
  roots.forEach((root, index) => {
    const message = messages[index];
    const messageId = normalizeMessageId(message.messageId);
    const reference = normalizedIds([
      message.inReplyTo,
      ...(message.references ?? []),
    ])[0];
    const candidate = messageId || reference || message.id;
    const current = keyByRoot.get(root);
    if (!current) {
      keyByRoot.set(root, candidate);
      return;
    }
    const currentIsLocal = current.startsWith("uid:");
    if (currentIsLocal && messageId) {
      keyByRoot.set(root, messageId);
      return;
    }
    if (!currentIsLocal && messageId && messageId < current) {
      keyByRoot.set(root, messageId);
    }
  });

  return roots.map((root, index) => keyByRoot.get(root) ?? messages[index].id);
}

export function stripQuotedText(text: string): string {
  const lines = text.split(/\r?\n/);
  const marker = lines.findIndex((line, index) => {
    if (index === 0) return false;
    const trimmed = line.trim();
    return (
      /^On .+ wrote:\s*$/i.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed) ||
      /^From:\s.+$/i.test(trimmed)
    );
  });
  if (marker > 0) return lines.slice(0, marker).join("\n").trim();

  const quoteStart = lines.findIndex(
    (line, index) => index > 0 && /^>+\s?/.test(line.trim()),
  );
  if (quoteStart > 0) {
    const rest = lines.slice(quoteStart).filter((line) => line.trim());
    if (rest.length > 0 && rest.every((line) => /^>+\s?/.test(line.trim()))) {
      return lines.slice(0, quoteStart).join("\n").trim();
    }
  }
  return text.trim();
}

export function stripQuotedHtml(html: string): string {
  let next = html;
  next = next.replace(
    /<div[^>]*(?:gmail_quote|yahoo_quoted|moz-cite-prefix)[^>]*>[\s\S]*$/i,
    "",
  );
  next = next.replace(
    /<div[^>]*id=["'](?:appendonsend|divRplyFwdMsg)["'][^>]*>[\s\S]*$/i,
    "",
  );
  next = next.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, "");
  next = next.replace(
    /(?:<br\s*\/?>|\n)\s*On\s[\s\S]{0,500}?wrote:\s*[\s\S]*$/i,
    "",
  );
  return next.trim();
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function withDisplayBodies<T extends ThreadBody>(
  messages: T[],
): Array<T & { displayText: string; displayHtml: string }> {
  const ids = threadIdSet(messages);
  return messages.map((message) => {
    const self = normalizeMessageId(message.messageId);
    const hasAncestor = relatedMessageIds(message).some(
      (id) => id !== self && ids.has(id),
    );
    if (!hasAncestor) {
      return { ...message, displayText: message.text, displayHtml: message.html };
    }
    const displayText = stripQuotedText(message.text);
    const strippedHtml = stripQuotedHtml(message.html);
    const displayHtml =
      message.html && visibleText(strippedHtml).length > 0
        ? strippedHtml
        : message.html;
    return {
      ...message,
      displayText: displayText || message.text,
      displayHtml,
    };
  });
}
