import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCallTranscript } from "./callTranscriptFormat";

describe("formatCallTranscript", () => {
  it("labels staff and the customer on a dual-channel call", () => {
    const text = formatCallTranscript(
      [
        { sentenceIndex: 1, mediaChannel: 2, transcript: "The generator will not start." },
        { sentenceIndex: 0, mediaChannel: 1, transcript: "This is the office." },
      ],
      "dual",
    );
    assert.equal(text, "You: This is the office.\nCustomer: The generator will not start.");
  });

  it("leaves a voicemail as a single speaker", () => {
    const text = formatCallTranscript(
      [
        { sentenceIndex: 0, mediaChannel: 1, transcript: "Please call me back." },
        { sentenceIndex: 1, transcript: "  " },
      ],
      "single",
    );
    assert.equal(text, "Please call me back.");
  });
});
