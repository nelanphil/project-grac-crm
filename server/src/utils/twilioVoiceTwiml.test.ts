import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientDialTwiml, buildRingAgentsTwiml } from "./twilioVoiceTwiml";

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

describe("ring agents TwiML", () => {
  const agents = Array.from({ length: 11 }, (_, index) => ({
    identity: `user_${index}`,
    userId: `id-${index}`,
  }));

  const xml = buildRingAgentsTwiml({
    agents,
    actionUrl: "/webhooks/twilio/voice/inbound/complete?accountSid=AC1",
    answeredUrlFor: (userId) =>
      `/webhooks/twilio/voice/inbound/answered?accountSid=AC1&userId=${userId}`,
    recordingStatusCallbackUrl: "/webhooks/twilio/voice/client/recording?accountSid=AC1",
    callerName: "Phil",
    callerNumber: "+17328419642",
    lineLabel: "MAIN",
    conversationId: "conv-1",
  });

  it("rings at most ten browsers and passes caller details", () => {
    assert.match(xml, /timeout="25"/);
    assert.match(xml, /answerOnBridge="true"/);
    assert.match(xml, /record="record-from-answer-dual"/);
    assert.match(
      xml,
      /action="\/webhooks\/twilio\/voice\/inbound\/complete\?accountSid=AC1"/,
    );
    assert.equal(xml.match(/<Identity>/g)?.length, 10);
    assert.match(xml, /<Identity>user_0<\/Identity>/);
    assert.match(xml, /<Identity>user_9<\/Identity>/);
    assert.doesNotMatch(xml, /<Identity>user_10<\/Identity>/);
    assert.match(xml, /<Parameter name="callerName" value="Phil"\/>/);
    assert.match(xml, /<Parameter name="callerNumber" value="\+17328419642"\/>/);
    assert.match(xml, /<Parameter name="lineLabel" value="MAIN"\/>/);
    assert.match(xml, /<Parameter name="conversationId" value="conv-1"\/>/);
    assert.match(
      xml,
      /statusCallback="\/webhooks\/twilio\/voice\/inbound\/answered\?accountSid=AC1&amp;userId=id-0"/,
    );
    assert.match(xml, /statusCallbackEvent="answered"/);
  });
});
