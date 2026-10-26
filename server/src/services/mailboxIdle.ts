import { EmailAccount, IEmailAccount } from "../models/mongo/EmailAccount";
import { publishDashboardChanged } from "./dashboardLive";
import { syncAccountInbox } from "./emailInboxSync.service";
import { watchInboxIdle } from "./mailbox.service";

type IdleSession = {
  abort: AbortController;
  key: string;
};

const sessions = new Map<string, IdleSession>();
let stopped = false;
let syncing = false;
let syncQueued = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function accountKey(account: IEmailAccount): string {
  return [
    account.imapHost,
    String(account.imapPort || 993),
    account.username,
    account.passwordEncrypted,
  ].join("|");
}

function syncAccount(account: IEmailAccount): void {
  void syncAccountInbox(String(account._id)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[inbox-email] ${account.username}: ${message}`);
  });
}

async function runAccount(
  account: IEmailAccount,
  signal: AbortSignal,
): Promise<void> {
  let delay = 2_000;
  syncAccount(account);
  while (!signal.aborted && !stopped) {
    const started = Date.now();
    try {
      await watchInboxIdle(account, signal, () => {
        syncAccount(account);
        publishDashboardChanged();
      });
      if (signal.aborted || stopped) return;
      if (Date.now() - started < 1_000) {
        await sleep(delay);
        delay = Math.min(delay * 2, 60_000);
      } else {
        delay = 2_000;
      }
    } catch (err) {
      if (signal.aborted || stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mailbox-idle] ${account.username}: ${message}`);
      await sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }
}

async function resync(): Promise<void> {
  const accounts = await EmailAccount.find({ isActive: true }).select(
    "imapHost imapPort username passwordEncrypted isActive",
  );
  const live = new Set<string>();
  for (const account of accounts) {
    if (!account.imapHost?.trim() || !account.passwordEncrypted) continue;
    const id = String(account._id);
    live.add(id);
    const key = accountKey(account);
    const current = sessions.get(id);
    if (current?.key === key) continue;
    current?.abort.abort();
    const abort = new AbortController();
    sessions.set(id, { abort, key });
    void runAccount(account, abort.signal);
  }
  for (const [id, session] of sessions) {
    if (live.has(id)) continue;
    session.abort.abort();
    sessions.delete(id);
  }
}

/** Open or restart IDLE for each active mailbox. Safe to call after account edits. */
export function syncMailboxIdle(): void {
  if (stopped) return;
  if (syncing) {
    syncQueued = true;
    return;
  }
  syncing = true;
  void resync()
    .catch((err) => {
      console.error("[mailbox-idle] sync failed:", err);
    })
    .finally(() => {
      syncing = false;
      if (!syncQueued) return;
      syncQueued = false;
      syncMailboxIdle();
    });
}

export function startMailboxIdle(): void {
  stopped = false;
  syncMailboxIdle();
}

export function stopMailboxIdle(): void {
  stopped = true;
  syncQueued = false;
  for (const session of sessions.values()) session.abort.abort();
  sessions.clear();
}
