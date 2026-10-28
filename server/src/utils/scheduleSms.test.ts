import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SMS_BODY_MAX } from "../schemas/messageTemplate.schema";
import { formatScheduleSms } from "./scheduleSms";
import { localDateToUtc } from "./scheduleTime";

const date = "2026-10-13";
const technicianName = "Charlie Ayers";
const appUrl = "https://app.example.com/dashboard";
const header = `Generator Maintenance of Florida\nTue, Oct 13\n${technicianName} schedule:`;
const footer = `View your schedule:\n${appUrl}`;

function at(hhmm: string): Date {
  return localDateToUtc(date, hhmm);
}

describe("formatScheduleSms", () => {
  it("orders jobs and stacks contact name, phone, and address", () => {
    const body = formatScheduleSms({
      date,
      technicianName,
      appUrl,
      jobs: [
        {
          scheduledStart: at("10:30"),
          contactName: "Jones",
          phone: "(386) 555-3434",
          street: "45 Oak Ave",
          city: "Springfield",
        },
        {
          scheduledStart: at("08:00"),
          contactName: "Smith",
          phone: "(386) 555-0100",
          street: "123 Main St",
          city: "Springfield",
        },
      ],
    });

    assert.equal(
      body,
      [
        header,
        "8:00 AM\nSmith\n(386) 555-0100\n123 Main St, Springfield",
        "10:30 AM\nJones\n(386) 555-3434\n45 Oak Ave, Springfield",
        footer,
      ].join("\n\n"),
    );
  });

  it("omits the phone line when the contact has no number", () => {
    const body = formatScheduleSms({
      date,
      technicianName,
      appUrl,
      jobs: [
        {
          scheduledStart: at("08:00"),
          contactName: "Smith",
          phone: "",
          street: "123 Main St",
          city: "Springfield",
        },
      ],
    });

    assert.equal(
      body,
      [
        header,
        "8:00 AM\nSmith\n123 Main St, Springfield",
        footer,
      ].join("\n\n"),
    );
  });

  it("places one schedule note under the customer", () => {
    const body = formatScheduleSms({
      date,
      technicianName,
      appUrl,
      jobs: [
        {
          scheduledStart: at("08:00"),
          contactName: "Smith",
          phone: "(386) 555-0100",
          street: "123 Main St",
          city: "Springfield",
          notes: ["Gate code 1234"],
        },
      ],
    });

    assert.equal(
      body,
      [
        header,
        "8:00 AM\nSmith\n(386) 555-0100\n123 Main St, Springfield\nNote: Gate code 1234",
        footer,
      ].join("\n\n"),
    );
  });

  it("places every schedule note under the customer, oldest first", () => {
    const body = formatScheduleSms({
      date,
      technicianName,
      appUrl,
      jobs: [
        {
          scheduledStart: at("08:00"),
          contactName: "Smith",
          phone: "(386) 555-0100",
          street: "123 Main St",
          city: "Springfield",
          notes: ["Gate code 1234", "Dog in the yard"],
        },
      ],
    });

    assert.equal(
      body,
      [
        header,
        [
          "8:00 AM",
          "Smith",
          "(386) 555-0100",
          "123 Main St, Springfield",
          "Note: Gate code 1234",
          "Note: Dog in the yard",
        ].join("\n"),
        footer,
      ].join("\n\n"),
    );
  });

  it("flattens line breaks and caps a long schedule note", () => {
    const body = formatScheduleSms({
      date,
      technicianName,
      appUrl,
      jobs: [
        {
          scheduledStart: at("08:00"),
          contactName: "Smith",
          phone: "",
          street: "123 Main St",
          city: "Springfield",
          notes: [`Bring\nladder ${"A".repeat(200)}`],
        },
      ],
    });

    const noteLine = body.split("\n").find((line) => line.startsWith("Note: "));
    assert.ok(noteLine);
    assert.equal(noteLine?.length, "Note: ".length + 160);
    assert.equal(noteLine?.endsWith("…"), true);
    assert.match(noteLine ?? "", /^Note: Bring ladder /);
  });

  it("says there are no appointments and still includes the app link", () => {
    assert.equal(
      formatScheduleSms({ date, technicianName, appUrl, jobs: [] }),
      [header, "No appointments.", footer].join("\n\n"),
    );
  });

  it("stops at the SMS limit, counts the jobs left off, and keeps the link", () => {
    const jobs = Array.from({ length: 40 }, (_, index) => ({
      scheduledStart: new Date(at("08:00").getTime() + index * 60_000),
      contactName: `Customer ${String(index).padStart(2, "0")}`,
      phone: "(386) 555-0100",
      street: "X".repeat(80),
      city: "Springfield",
    }));

    const body = formatScheduleSms({ date, technicianName, appUrl, jobs });
    const sections = body.split("\n\n");
    const omittedLine = sections.find((section) =>
      section.startsWith("…and "),
    );
    const omitted = Number(omittedLine?.match(/^…and (\d+) more$/)?.[1]);
    const shownJobs = sections.filter((section) =>
      section.startsWith("8:"),
    ).length;

    assert.ok(body.length <= SMS_BODY_MAX);
    assert.equal(sections[0], header);
    assert.equal(sections.at(-1), footer);
    assert.match(omittedLine ?? "", /^…and \d+ more$/);
    assert.ok(omitted > 0);
    assert.equal(shownJobs + omitted, jobs.length);
    assert.match(sections[1] ?? "", /Customer 00/);
    assert.doesNotMatch(body, /No appointments/);
  });
});
