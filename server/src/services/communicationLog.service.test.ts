import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CommunicationLogItem,
  emailLogMeta,
  groupCommunicationLog,
  phoneGroupKey,
  twilioLogMeta,
} from "./communicationLog.service";

function item(overrides: Partial<CommunicationLogItem> & Pick<CommunicationLogItem, "id" | "at" | "channel" | "direction">): CommunicationLogItem {
  return {
    subject: "",
    preview: "",
    status: "sent",
    source: "inbox",
    from: "",
    to: "",
    customerRef: null,
    party: "",
    handle: "",
    groupKey: "",
    messageId: "",
    inReplyTo: "",
    references: [],
    providerMessageId: "",
    inMonth: true,
    emailId: null,
    actor: "staff",
    ...overrides,
  };
}

describe("twilioLogMeta", () => {
  it("labels wizard, invoice, auto-reply, and inbox texts", () => {
    assert.deepEqual(
      twilioLogMeta({ direction: "inbound" }),
      { source: "inbox", actor: "customer" },
    );
    assert.deepEqual(
      twilioLogMeta({ direction: "outbound", autoReply: "missed-call" }),
      { source: "auto-reply", actor: "system" },
    );
    assert.deepEqual(
      twilioLogMeta({ direction: "outbound", sendSource: "wizard" }),
      { source: "wizard", actor: "system" },
    );
    assert.deepEqual(
      twilioLogMeta({
        direction: "outbound",
        invoiceRef: "inv",
        createdByUserRef: "user",
      }),
      { source: "invoice", actor: "staff" },
    );
  });
});

describe("emailLogMeta", () => {
  it("treats a mailbox send as inbox and a wizard send as wizard", () => {
    assert.deepEqual(
      emailLogMeta({ direction: "inbound" }),
      { source: "inbox", actor: "customer" },
    );
    assert.deepEqual(
      emailLogMeta({
        direction: "outbound",
        mailboxFolder: "sent",
        createdByUserRef: "user",
      }),
      { source: "inbox", actor: "staff" },
    );
    assert.deepEqual(
      emailLogMeta({ direction: "outbound", createdByUserRef: "user" }),
      { source: "wizard", actor: "staff" },
    );
  });
});

describe("phoneGroupKey", () => {
  it("keeps a thread id ahead of the phone pair", () => {
    assert.equal(
      phoneGroupKey("outbound", "+15551111", "+15552222", "abc"),
      "thread:abc",
    );
    assert.equal(
      phoneGroupKey("inbound", "+1 (555) 222-2222", "15551111", null),
      phoneGroupKey("outbound", "15551111", "+15552222222", null),
    );
  });
});

describe("groupCommunicationLog", () => {
  it("links an email reply to the outbound it answers, even in another month", () => {
    const result = groupCommunicationLog(
      [
        item({
          id: "may",
          at: new Date("2026-05-02T15:00:00Z"),
          channel: "email",
          direction: "outbound",
          subject: "Invoice ready",
          messageId: "<out@crm>",
          customerRef: "c1",
          party: "Ada",
          handle: "ada@example.com",
          inMonth: false,
          emailId: "may",
          source: "wizard",
          actor: "system",
        }),
        item({
          id: "june",
          at: new Date("2026-06-03T15:00:00Z"),
          channel: "email",
          direction: "inbound",
          subject: "Re: Invoice ready",
          messageId: "<reply@ada>",
          inReplyTo: "<out@crm>",
          references: ["<out@crm>"],
          customerRef: "c1",
          party: "Ada",
          handle: "ada@example.com",
          inMonth: true,
          emailId: "june",
          source: "inbox",
          actor: "customer",
          status: "received",
        }),
      ],
      { customerNames: new Map([["c1", "Ada Lovelace"]]) },
    );

    assert.equal(result.total, 1);
    const thread = result.threads[0];
    assert.equal(thread.status, "replied");
    assert.equal(thread.customerName, "Ada Lovelace");
    assert.equal(thread.replyCount, 1);
    assert.deepEqual(
      thread.entries.map((entry) => entry.id),
      ["may", "june"],
    );
    assert.equal(thread.entries[0].inMonth, false);
    assert.equal(result.summary.outbound, 0);
    assert.equal(result.summary.inbound, 1);
    assert.equal(result.summary.repliedThreads, 1);
    assert.equal(result.summary.replyRate, 100);
    assert.equal(result.summary.byChannel.email.inbound, 1);
  });

  it("does not merge emails that only share a subject", () => {
    const result = groupCommunicationLog([
      item({
        id: "a",
        at: new Date("2026-06-01T12:00:00Z"),
        channel: "email",
        direction: "outbound",
        subject: "Hello",
        messageId: "<a@crm>",
        handle: "a@example.com",
      }),
      item({
        id: "b",
        at: new Date("2026-06-01T13:00:00Z"),
        channel: "email",
        direction: "outbound",
        subject: "Hello",
        messageId: "<b@crm>",
        handle: "b@example.com",
      }),
    ]);
    assert.equal(result.total, 2);
    assert.equal(result.summary.byChannel.email.outbound, 2);
  });

  it("groups texts by thread and counts a later reply", () => {
    const result = groupCommunicationLog([
      item({
        id: "out",
        at: new Date("2026-06-04T12:00:00Z"),
        channel: "sms",
        direction: "outbound",
        groupKey: "thread:t1",
        preview: "Your appointment is tomorrow",
        source: "wizard",
        actor: "system",
        handle: "+15550001",
        party: "+15550001",
      }),
      item({
        id: "in",
        at: new Date("2026-06-04T13:00:00Z"),
        channel: "sms",
        direction: "inbound",
        groupKey: "thread:t1",
        preview: "Thanks",
        source: "inbox",
        actor: "customer",
        status: "received",
        handle: "+15550001",
      }),
      item({
        id: "other",
        at: new Date("2026-06-04T14:00:00Z"),
        channel: "sms",
        direction: "outbound",
        groupKey: "thread:t2",
        preview: "Different person",
        handle: "+15550002",
      }),
    ]);

    assert.equal(result.total, 2);
    const replied = result.threads.find((thread) => thread.replyCount === 1);
    assert.ok(replied);
    assert.equal(replied.status, "replied");
    assert.deepEqual(
      replied.entries.map((entry) => entry.id),
      ["out", "in"],
    );
    const quiet = result.threads.find((thread) => thread.id === "thread:t2");
    assert.equal(quiet?.status, "no-reply");
  });

  it("keeps a mailbox contact form and drops the matching inbox email", () => {
    const result = groupCommunicationLog([
      item({
        id: "mail",
        at: new Date("2026-06-05T12:00:00Z"),
        channel: "email",
        direction: "inbound",
        subject: "New contact form",
        messageId: "<form-msg@mail>",
        providerMessageId: "<form-msg@mail>",
        source: "inbox",
        actor: "customer",
        status: "received",
        handle: "sam@example.com",
        inMonth: true,
      }),
      item({
        id: "form",
        at: new Date("2026-06-05T12:00:01Z"),
        channel: "contact-form",
        direction: "inbound",
        subject: "Contact form",
        preview: "Need a quote",
        source: "mailbox-form",
        actor: "customer",
        status: "received",
        party: "Sam Lee",
        handle: "sam@example.com",
        providerMessageId: "form-msg@mail",
      }),
    ]);

    assert.equal(result.total, 1);
    assert.equal(result.threads[0].channels[0], "contact-form");
    assert.equal(result.threads[0].customerName, "Sam Lee");
    assert.equal(result.threads[0].status, "inbound-only");
    assert.equal(result.summary.byChannel.email.inbound, 0);
    assert.equal(result.summary.byChannel["contact-form"].inbound, 1);
  });

  it("still shows the contact form when only the inbox copy is in this month", () => {
    const result = groupCommunicationLog([
      item({
        id: "mail",
        at: new Date("2026-06-05T12:00:00Z"),
        channel: "email",
        direction: "inbound",
        messageId: "<form-msg@mail>",
        source: "inbox",
        actor: "customer",
        inMonth: true,
        handle: "sam@example.com",
      }),
      item({
        id: "form",
        at: new Date("2026-05-01T12:00:00Z"),
        channel: "contact-form",
        direction: "inbound",
        source: "mailbox-form",
        actor: "customer",
        party: "Sam Lee",
        handle: "sam@example.com",
        providerMessageId: "<form-msg@mail>",
        inMonth: false,
      }),
    ]);

    assert.equal(result.total, 1);
    assert.equal(result.threads[0].id, "form:form");
    assert.equal(result.threads[0].entries[0].inMonth, true);
    assert.equal(result.summary.byChannel["contact-form"].inbound, 1);
  });

  it("filters to threads with a reply and matches a customer name", () => {
    const rows = [
      item({
        id: "out",
        at: new Date("2026-06-04T12:00:00Z"),
        channel: "sms",
        direction: "outbound",
        groupKey: "thread:t1",
        customerRef: "c1",
        handle: "+15550001",
      }),
      item({
        id: "in",
        at: new Date("2026-06-04T13:00:00Z"),
        channel: "sms",
        direction: "inbound",
        groupKey: "thread:t1",
        customerRef: "c1",
        handle: "+15550001",
        actor: "customer",
      }),
      item({
        id: "solo",
        at: new Date("2026-06-04T14:00:00Z"),
        channel: "sms",
        direction: "outbound",
        groupKey: "thread:t2",
        customerRef: "c2",
        handle: "+15550002",
      }),
    ];
    const names = new Map([
      ["c1", "Ada Lovelace"],
      ["c2", "Grace Hopper"],
    ]);
    const replied = groupCommunicationLog(rows, {
      repliedOnly: true,
      customerNames: names,
    });
    assert.equal(replied.total, 1);
    assert.equal(replied.threads[0].customerName, "Ada Lovelace");
    assert.equal(replied.summary.threads, 2);

    const searched = groupCommunicationLog(rows, {
      search: "hopper",
      customerNames: names,
    });
    assert.equal(searched.total, 1);
    assert.equal(searched.threads[0].customerName, "Grace Hopper");
  });
});
