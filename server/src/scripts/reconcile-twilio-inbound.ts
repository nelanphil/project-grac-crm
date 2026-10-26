/**
 * Compare Twilio's inbound message and call logs with TwilioCommunication
 * and optionally import the ones this CRM never saved.
 *
 * Dry run (default):
 *   npx tsx src/scripts/reconcile-twilio-inbound.ts
 *   npx tsx src/scripts/reconcile-twilio-inbound.ts --since=2026-07-01
 *
 * Import:
 *   npx tsx src/scripts/reconcile-twilio-inbound.ts --since=2026-07-01 --apply
 *
 * Optional:
 *   --account=ACxxxxxxxx
 *   --channel=sms|voice|all
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  ensureTwilioPhoneLineShape,
  TwilioAccount,
} from "../models/mongo/TwilioAccount";
import type { ITwilioAccount } from "../models/mongo/TwilioAccount";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import {
  fetchRecordingTranscript,
  listCallRecordings,
  listInboundCalls,
  listInboundMessages,
} from "../services/twilio.service";
import type {
  TwilioCallRecording,
  TwilioInboundCall,
  TwilioInboundMessage,
} from "../services/twilio.service";
import {
  ingestInboundMessage,
  ingestInboundVoice,
  isSmsOptOutKeyword,
} from "../services/twilioInboundIngest.service";
import { normalizePhoneDigits } from "../utils/customerSites";
import { listedPhoneNumbers } from "../utils/twilioPhoneLines";

type Channel = "sms" | "voice" | "all";

type Options = {
  since: Date;
  apply: boolean;
  accountSid: string | null;
  channel: Channel;
};

type Totals = {
  found: number;
  already: number;
  missing: number;
  imported: number;
  failed: number;
  unmatched: number;
  optOut: number;
};

type ContactLabel = { label: string; matched: boolean };

type PhoneIndex = {
  contacts: Array<{
    name: string;
    customerName: string;
    phone: string;
  }>;
};

function phonesMatchDigits(stored: string, incomingDigits: string): boolean {
  const digits = normalizePhoneDigits(stored);
  if (digits.length < 7 || incomingDigits.length < 7) return false;
  return (
    digits === incomingDigits ||
    digits.endsWith(incomingDigits) ||
    incomingDigits.endsWith(digits) ||
    (digits.length >= 10 &&
      incomingDigits.length >= 10 &&
      digits.slice(-10) === incomingDigits.slice(-10))
  );
}

function personName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

async function loadPhoneIndex(): Promise<PhoneIndex> {
  const [contacts, customers] = await Promise.all([
    CustomerContact.find({ phone: { $exists: true, $nin: [null, ""] } })
      .select("customerRef first last phone")
      .lean(),
    Customer.find({ deletedAt: null })
      .select("accountName first last phone phoneDigits")
      .lean(),
  ]);
  const customerNames = new Map(
    customers.map((customer) => [
      String(customer._id),
      (customer.accountName || "").trim() ||
        personName(customer.first, customer.last),
    ]),
  );
  return {
    contacts: [
      ...contacts.map((contact) => ({
        name: personName(contact.first, contact.last),
        customerName: customerNames.get(String(contact.customerRef)) || "",
        phone: contact.phone || "",
      })),
      ...customers.map((customer) => ({
        name: personName(customer.first, customer.last),
        customerName:
          (customer.accountName || "").trim() ||
          personName(customer.first, customer.last),
        phone: customer.phoneDigits || customer.phone || "",
      })),
    ],
  };
}

async function labelForPhone(
  phone: string,
  index: PhoneIndex,
  cache: Map<string, ContactLabel>,
): Promise<ContactLabel> {
  const key = normalizePhoneDigits(phone) || phone || "(blank)";
  const cached = cache.get(key);
  if (cached) return cached;

  const digits = normalizePhoneDigits(phone);
  const match =
    digits.length >= 7
      ? index.contacts.find((contact) => phonesMatchDigits(contact.phone, digits))
      : undefined;
  const parts = match
    ? [...new Set([match.customerName, match.name].filter(Boolean))]
    : [];
  const result = match
    ? {
        label: parts.join(" / ") || "matched contact",
        matched: true,
      }
    : { label: "unmatched", matched: false };
  cache.set(key, result);
  return result;
}

type UnmatchedItem = {
  channel: "sms" | "voice";
  at: string;
  from: string;
  to: string;
  detail: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function parseSince(raw: string | undefined): Date {
  if (!raw) return new Date(Date.now() - 90 * DAY_MS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("--since must be YYYY-MM-DD");
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("--since is not a valid date");
  return date;
}

function parseChannel(raw: string | undefined): Channel {
  if (!raw || raw === "all") return "all";
  if (raw === "sms" || raw === "voice") return raw;
  throw new Error("--channel must be sms, voice, or all");
}

function parseOptions(): Options {
  return {
    since: parseSince(argValue("since")),
    apply: process.argv.includes("--apply"),
    accountSid: argValue("account") || null,
    channel: parseChannel(argValue("channel")),
  };
}

function emptyTotals(): Totals {
  return {
    found: 0,
    already: 0,
    missing: 0,
    imported: 0,
    failed: 0,
    unmatched: 0,
    optOut: 0,
  };
}

function addTotals(target: Totals, extra: Totals): void {
  target.found += extra.found;
  target.already += extra.already;
  target.missing += extra.missing;
  target.imported += extra.imported;
  target.failed += extra.failed;
  target.unmatched += extra.unmatched;
  target.optOut += extra.optOut;
}

function formatTotals(totals: Totals): string {
  return `found=${totals.found} already=${totals.already} missing=${totals.missing} imported=${totals.imported} failed=${totals.failed} unmatched=${totals.unmatched} optOut=${totals.optOut}`;
}

function preview(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "(empty)";
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79)}…`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function existingSids(
  accountSid: string,
  sids: string[],
): Promise<Set<string>> {
  const unique = [...new Set(sids.filter(Boolean))];
  const known = new Set<string>();
  for (let i = 0; i < unique.length; i += 500) {
    const rows = await TwilioCommunication.find({
      accountSid,
      twilioSid: { $in: unique.slice(i, i + 500) },
    })
      .select("twilioSid")
      .lean();
    for (const row of rows) {
      if (row.twilioSid) known.add(row.twilioSid);
    }
  }
  return known;
}

async function reconcileMessages(params: {
  account: ITwilioAccount;
  number: string;
  since: Date;
  apply: boolean;
  phoneIndex: PhoneIndex;
  labels: Map<string, ContactLabel>;
  unmatched: UnmatchedItem[];
}): Promise<Totals> {
  const totals = emptyTotals();
  let messages: TwilioInboundMessage[];
  try {
    messages = await listInboundMessages(params.account, {
      to: params.number,
      since: params.since,
    });
  } catch (err) {
    totals.failed += 1;
    console.error(`    failed to list messages: ${errorMessage(err)}`);
    return totals;
  }

  totals.found = messages.length;
  const known = await existingSids(
    params.account.accountSid,
    messages.map((message) => message.sid),
  );
  const missing = messages
    .filter((message) => message.sid && !known.has(message.sid))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  totals.already = messages.length - missing.length;
  totals.missing = missing.length;

  for (const message of missing) {
    const who = await labelForPhone(message.from, params.phoneIndex, params.labels);
    const optOut = isSmsOptOutKeyword(message.body);
    if (!who.matched) totals.unmatched += 1;
    if (optOut) totals.optOut += 1;
    const at = message.date.toISOString();
    const detail = `${preview(message.body)}${optOut ? " [STOP]" : ""}`;
    const line = `${at} sms from ${message.from || "(unknown)"} → ${message.to} ${who.label} — "${detail}"`;
    if (!who.matched) {
      params.unmatched.push({
        channel: "sms",
        at,
        from: message.from || "(unknown)",
        to: message.to,
        detail,
      });
    }

    if (!params.apply) {
      console.log(`    MISSING ${line}`);
      continue;
    }

    try {
      await ingestInboundMessage({
        account: params.account,
        twilioSid: message.sid,
        fromNumber: message.from,
        toNumber: message.to,
        body: message.body,
        mediaUrls: message.mediaUrls,
        rawStatus: message.status || "received",
        occurredAt: message.date,
        backfilled: true,
      });
      totals.imported += 1;
      console.log(`    IMPORTED ${line}`);
    } catch (err) {
      totals.failed += 1;
      console.error(`    FAILED ${line} — ${errorMessage(err)}`);
    }
  }

  return totals;
}

async function recordingsForCall(
  account: ITwilioAccount,
  callSid: string,
): Promise<TwilioCallRecording[]> {
  try {
    return await listCallRecordings(account, callSid);
  } catch (err) {
    console.warn(
      `    recordings unavailable for ${callSid}: ${errorMessage(err)}`,
    );
    return [];
  }
}

async function reconcileCalls(params: {
  account: ITwilioAccount;
  number: string;
  since: Date;
  apply: boolean;
  phoneIndex: PhoneIndex;
  labels: Map<string, ContactLabel>;
  unmatched: UnmatchedItem[];
}): Promise<Totals> {
  const totals = emptyTotals();
  let calls: TwilioInboundCall[];
  try {
    calls = await listInboundCalls(params.account, {
      to: params.number,
      since: params.since,
    });
  } catch (err) {
    totals.failed += 1;
    console.error(`    failed to list calls: ${errorMessage(err)}`);
    return totals;
  }

  totals.found = calls.length;
  const known = await existingSids(
    params.account.accountSid,
    calls.flatMap((call) => [call.sid, call.parentCallSid]),
  );
  const missing = calls
    .filter(
      (call) =>
        call.sid &&
        !known.has(call.sid) &&
        !(call.parentCallSid && known.has(call.parentCallSid)),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  totals.already = calls.length - missing.length;
  totals.missing = missing.length;

  for (const call of missing) {
    const who = await labelForPhone(call.from, params.phoneIndex, params.labels);
    if (!who.matched) totals.unmatched += 1;
    const recordings = await recordingsForCall(params.account, call.sid);
    const at = call.date.toISOString();
    const duration =
      call.durationSeconds == null ? "unknown duration" : `${call.durationSeconds}s`;
    const detail = `${duration}, voicemail=${recordings.length > 0 ? "yes" : "no"}, status=${call.status || "unknown"}`;
    const line = `${at} voice from ${call.from || "(unknown)"} → ${call.to} ${who.label} — ${detail}`;
    if (!who.matched) {
      params.unmatched.push({
        channel: "voice",
        at,
        from: call.from || "(unknown)",
        to: call.to,
        detail,
      });
    }

    if (!params.apply) {
      console.log(`    MISSING ${line}`);
      continue;
    }

    try {
      const first = recordings[0];
      const transcript = first
        ? await fetchRecordingTranscript(params.account, first.sid)
        : "";
      await ingestInboundVoice({
        account: params.account,
        callSid: call.sid,
        parentCallSid: call.parentCallSid || undefined,
        fromNumber: call.from,
        toNumber: call.to,
        statusRaw: call.status || undefined,
        defaultStatus: "completed",
        transcript: transcript || undefined,
        recordingUrl: first?.url,
        durationSeconds: first?.durationSeconds ?? call.durationSeconds,
        occurredAt: call.date,
        backfilled: true,
      });
      totals.imported += 1;
      console.log(`    IMPORTED ${line}`);
    } catch (err) {
      totals.failed += 1;
      console.error(`    FAILED ${line} — ${errorMessage(err)}`);
    }
  }

  return totals;
}

async function reconcile(options: Options): Promise<void> {
  await ensureTwilioPhoneLineShape();
  const filter: Record<string, unknown> = { isActive: true };
  if (options.accountSid) filter.accountSid = options.accountSid;
  const accounts = await TwilioAccount.find(filter).sort({ friendlyName: 1 });

  console.log(
    `[reconcile-twilio-inbound] ${options.apply ? "Apply — writing missing inbound texts and calls." : "Dry run — no writes. Re-run with --apply to import."}`,
  );
  console.log(
    `since=${options.since.toISOString()} channel=${options.channel} account=${options.accountSid || "all active"}`,
  );

  if (accounts.length === 0) {
    if (options.accountSid) {
      const any = await TwilioAccount.findOne({ accountSid: options.accountSid })
        .select("isActive friendlyName")
        .lean();
      if (any && any.isActive === false) {
        console.log(
          `Account ${options.accountSid} (${any.friendlyName}) is inactive; nothing to reconcile.`,
        );
      } else {
        console.log(`No Twilio account found for ${options.accountSid}.`);
      }
    } else {
      console.log("No active Twilio accounts.");
    }
    return;
  }

  const labels = new Map<string, ContactLabel>();
  const phoneIndex = await loadPhoneIndex();
  const unmatched: UnmatchedItem[] = [];
  const grand = emptyTotals();

  for (const account of accounts) {
    console.log(`Account ${account.friendlyName} (${account.accountSid})`);
    const numbers = listedPhoneNumbers(account.phoneNumbers);
    if (numbers.length === 0) {
      console.log("  no phone numbers configured; skipped");
      continue;
    }

    for (const number of numbers) {
      console.log(`  ${number}`);
      const numberTotals = emptyTotals();
      if (options.channel !== "voice") {
        addTotals(
          numberTotals,
          await reconcileMessages({
            account,
            number,
            since: options.since,
            apply: options.apply,
            phoneIndex,
            labels,
            unmatched,
          }),
        );
      }
      if (options.channel !== "sms") {
        addTotals(
          numberTotals,
          await reconcileCalls({
            account,
            number,
            since: options.since,
            apply: options.apply,
            phoneIndex,
            labels,
            unmatched,
          }),
        );
      }
      addTotals(grand, numberTotals);
      console.log(`    ${formatTotals(numberTotals)}`);
    }
  }

  console.log(`Total ${formatTotals(grand)}`);
  if (unmatched.length === 0) {
    console.log("Unmatched (no contact): 0");
    return;
  }
  console.log(`Unmatched (no contact): ${unmatched.length}`);
  for (const item of unmatched) {
    console.log(
      `  ${item.at} ${item.channel} from ${item.from} → ${item.to} — ${item.detail}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  try {
    await connectMongoDB();
    await reconcile(options);
  } finally {
    await disconnectMongoDB();
  }
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
