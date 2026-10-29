import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendWorkOrderAppointmentSchema } from "../schemas/workOrder.schema";
import {
  appointmentNoticeKey,
  appointmentSendBlocker,
  fillAppointmentTokens,
  formatAppointmentDateLabel,
  formatAppointmentTimePhrase,
} from "./appointmentNotice.service";

const TECH_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TECH_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("appointmentNoticeKey", () => {
  const visit = {
    date: new Date("2026-11-05T00:00:00.000Z"),
    scheduledStart: new Date("2026-11-05T14:00:00.000Z"),
    assignedUserRefs: [TECH_B, TECH_A],
  };

  it("builds a stable key from the date, dispatch time, and crew", () => {
    assert.equal(
      appointmentNoticeKey(visit),
      `2026-11-05|2026-11-05T14:00:00.000Z|${TECH_A},${TECH_B}`,
    );
  });

  it("changes when the technician or the time changes", () => {
    const original = appointmentNoticeKey(visit);
    assert.notEqual(
      appointmentNoticeKey({ ...visit, assignedUserRefs: [TECH_A] }),
      original,
    );
    assert.notEqual(
      appointmentNoticeKey({
        ...visit,
        scheduledStart: new Date("2026-11-05T15:00:00.000Z"),
      }),
      original,
    );
  });

  it("uses the single assignee when the crew list is empty", () => {
    assert.equal(
      appointmentNoticeKey({
        date: "2026-11-05",
        assignedUserRef: TECH_A,
      }),
      `2026-11-05||${TECH_A}`,
    );
  });
});

describe("appointmentSendBlocker", () => {
  it("requires a date and a technician", () => {
    assert.equal(
      appointmentSendBlocker({ assignedUserRefs: [TECH_A] }),
      "Set a date before telling the customer.",
    );
    assert.equal(
      appointmentSendBlocker({ date: "2026-11-05" }),
      "Assign a technician before telling the customer.",
    );
    assert.equal(
      appointmentSendBlocker({
        date: "2026-11-05",
        assignedUserRefs: [TECH_A],
      }),
      null,
    );
  });

  it("rejects a deleted work order", () => {
    assert.equal(
      appointmentSendBlocker({
        date: "2026-11-05",
        assignedUserRefs: [TECH_A],
        deletedAt: new Date("2026-11-01T00:00:00.000Z"),
      }),
      "This work order is deleted.",
    );
  });
});

describe("sendWorkOrderAppointmentSchema", () => {
  it("requires text, email, or both", () => {
    const empty = sendWorkOrderAppointmentSchema.safeParse({});
    assert.equal(empty.success, false);
    if (!empty.success) {
      assert.equal(empty.error.issues[0]?.message, "Choose text, email, or both.");
    }

    assert.equal(
      sendWorkOrderAppointmentSchema.safeParse({
        sms: { phone: "8135550100" },
      }).success,
      true,
    );
    assert.equal(
      sendWorkOrderAppointmentSchema.safeParse({
        email: { address: "customer@example.com" },
        sms: { phone: "8135550100" },
      }).success,
      true,
    );
  });
});

describe("appointment copy", () => {
  it("labels the visit date and the dispatch clock", () => {
    assert.equal(formatAppointmentDateLabel("2026-11-05"), "Thursday, November 5");
    assert.equal(
      formatAppointmentTimePhrase({
        scheduledStart: new Date("2026-11-05T14:00:00.000Z"),
      }),
      " at 9:00 AM",
    );
  });

  it("uses the arrival window when the stop has no dispatch time", () => {
    assert.equal(
      formatAppointmentTimePhrase({
        desiredStartTime: "08:00",
        desiredStartBy: "10:00",
      }),
      " between 8:00 AM and 10:00 AM",
    );
  });

  it("fills appointment tokens and escapes html", () => {
    const filled = fillAppointmentTokens(
      "<p>{{appointment_date}}{{appointment_time}} with {{technician_name}} at {{service_address}}</p>",
      {
        dateLabel: "Thursday, November 5",
        timePhrase: " at 9:00 AM",
        technicianName: "Sam & Rivera",
        serviceAddress: "123 Oak Street",
      },
    );
    assert.match(filled, /Thursday, November 5 at 9:00 AM/);
    assert.match(filled, /Sam &amp; Rivera/);
    assert.match(filled, /123 Oak Street/);
  });
});
