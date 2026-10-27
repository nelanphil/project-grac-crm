import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientDialTwiml } from "./twilioVoiceTwiml";

describe("client dial TwiML", () => {
  it("dials the customer from the selected caller id", () => {
    const xml = buildClientDialTwiml({
      from: "+15551110000",
      to: "+15552220000",
      actionUrl: "https://api.example.com/webhooks/twilio/voice/client/complete?intentId=abc",
      recordingStatusCallbackUrl:
        "https://api.example.com/webhooks/twilio/voice/client/recording?intentId=abc",
    });
    assert.match(xml, /<Dial[^>]*callerId="\+15551110000"/);
    assert.match(xml, /record="record-from-answer-dual"/);
    assert.match(
      xml,
      /recordingStatusCallback="https:\/\/api\.example\.com\/webhooks\/twilio\/voice\/client\/recording\?intentId=abc"/,
    );
    assert.match(xml, /<Number>\+15552220000<\/Number>/);
    assert.match(xml, /action="https:\/\/api\.example\.com\/webhooks\/twilio\/voice\/client\/complete\?intentId=abc"/);
  });
});
