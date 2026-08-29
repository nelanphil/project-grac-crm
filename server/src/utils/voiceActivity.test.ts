import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatVoicemailLine,
  mergeVoiceActivity,
  toTranscriptLines,
  voiceConversationPreview,
} from "./voiceActivity";

describe("toTranscriptLines", () => {
  it("splits the activity log and tags voicemail vs event", () => {
    const transcript = [
      "Call started.",
      "Pressed 2 to leave a message.",
      "Voicemail: Hayden loves chocolate milk",
    ].join("\n");
    assert.deepEqual(toTranscriptLines(transcript), [
      { kind: "event", text: "Call started." },
      { kind: "event", text: "Pressed 2 to leave a message." },
      { kind: "voicemail", text: "Voicemail: Hayden loves chocolate milk" },
    ]);
  });

  it("treats Voicemail: case-insensitively", () => {
    assert.deepEqual(toTranscriptLines("voicemail: hi"), [
      { kind: "voicemail", text: "voicemail: hi" },
    ]);
  });
});

describe("voiceConversationPreview", () => {
  it("uses Left a voicemail when a voicemail line exists", () => {
    const transcript = [
      "Call started.",
      "Pressed 2 to leave a message.",
      "Voicemail: Hayden loves chocolate milk",
    ].join("\n");
    assert.equal(voiceConversationPreview(transcript), "Left a voicemail");
  });

  it("uses the last event when there is no voicemail", () => {
    const transcript = ["Call started.", "Pressed 2 to leave a message."].join(
      "\n",
    );
    assert.equal(
      voiceConversationPreview(transcript),
      "Pressed 2 to leave a message",
    );
  });

  it("falls back to Inbound call", () => {
    assert.equal(voiceConversationPreview(""), "Inbound call");
  });
});

describe("mergeVoiceActivity", () => {
  it("replaces only the Voicemail line and keeps IVR events", () => {
    const existing = [
      "Call started.",
      "Pressed 2 to leave a message.",
      "Voicemail: Hayden loves chocolate milk",
    ].join("\n");
    const next = formatVoicemailLine("Payton loves chocolate milk");
    assert.equal(
      mergeVoiceActivity(existing, next),
      [
        "Call started.",
        "Pressed 2 to leave a message.",
        "Voicemail: Payton loves chocolate milk",
      ].join("\n"),
    );
  });

  it("appends a voicemail line when missing", () => {
    assert.equal(
      mergeVoiceActivity("Call started.", formatVoicemailLine("hello")),
      "Call started.\nVoicemail: hello",
    );
  });
});
