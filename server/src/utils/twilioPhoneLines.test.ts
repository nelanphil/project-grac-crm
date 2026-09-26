import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySubmittedLabels,
  labelForNumber,
  mergePhoneLines,
  normalizePhoneLines,
} from "./twilioPhoneLines";

describe("twilio phone line labels", () => {
  it("normalizes legacy string numbers into unlabeled lines", () => {
    const lines = normalizePhoneLines(["+15551234567", "  ", "+15559876543"]);
    assert.deepEqual(lines, [
      {
        phoneNumber: "+15551234567",
        label: "",
        twilioFriendlyName: "",
        incomingSid: "",
        sms: false,
        mms: false,
        voice: false,
      },
      {
        phoneNumber: "+15559876543",
        label: "",
        twilioFriendlyName: "",
        incomingSid: "",
        sms: false,
        mms: false,
        voice: false,
      },
    ]);
  });

  it("keeps user labels and drops numbers Twilio no longer returns", () => {
    const merged = mergePhoneLines(
      [
        { phoneNumber: "+15551234567", label: "Main line" },
        { phoneNumber: "+15550000000", label: "Old line" },
      ],
      [
        {
          phoneNumber: "+1 (555) 123-4567",
          friendlyName: "Twilio main",
          sid: "PN111",
          sms: true,
          mms: true,
          voice: true,
        },
        {
          phoneNumber: "+15557654321",
          friendlyName: "New",
          sid: "PN222",
          sms: true,
          mms: false,
          voice: true,
        },
      ],
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.phoneNumber, "+1 (555) 123-4567");
    assert.equal(merged[0]?.label, "Main line");
    assert.equal(merged[0]?.incomingSid, "PN111");
    assert.equal(merged[1]?.label, "");
    assert.equal(merged[1]?.twilioFriendlyName, "New");
    assert.equal(
      labelForNumber(merged, "15551234567"),
      "Main line",
    );
    assert.equal(labelForNumber(merged, "+15550000000"), null);
  });

  it("applies submitted labels onto matching lines only", () => {
    const updated = applySubmittedLabels(
      [
        {
          phoneNumber: "+15551234567",
          label: "Old",
          twilioFriendlyName: "Twilio",
          incomingSid: "PN1",
          sms: true,
          mms: false,
          voice: true,
        },
      ],
      [
        { phoneNumber: "5551234567", label: "Office" },
        { phoneNumber: "+15559999999", label: "Ignored" },
      ],
    );
    assert.equal(updated.length, 1);
    assert.equal(updated[0]?.label, "Office");
    assert.equal(updated[0]?.incomingSid, "PN1");
  });
});
