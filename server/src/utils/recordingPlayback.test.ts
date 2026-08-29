import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTwilioApiUrl,
  publicMediaUrls,
  signRecordingPlaybackToken,
  storedTwilioRecordingUrl,
  verifyRecordingPlaybackToken,
} from "./recordingPlayback";

const TWILIO_URL =
  "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx";
const TWILIO_MEDIA_URL =
  "https://media.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx";

describe("recording playback tokens and public mediaUrls", () => {
  it("recognizes Twilio recording URLs", () => {
    assert.equal(isTwilioApiUrl(TWILIO_URL), true);
    assert.equal(isTwilioApiUrl(TWILIO_MEDIA_URL), true);
    assert.equal(isTwilioApiUrl("https://example.com/audio.mp3"), false);
  });

  it("round-trips a short-lived token scoped to the communication", () => {
    const token = signRecordingPlaybackToken("64b000000000000000000001");
    assert.equal(
      verifyRecordingPlaybackToken(token, "64b000000000000000000001"),
      true,
    );
    assert.equal(
      verifyRecordingPlaybackToken(token, "64b000000000000000000002"),
      false,
    );
  });

  it("exposes a signed CRM path for voice and keeps the Twilio URL out of the public payload", () => {
    const doc = {
      _id: "64b000000000000000000001",
      channel: "voice",
      direction: "inbound",
      status: "completed",
      fromNumber: "+15551212",
      toNumber: "+15550000",
      body: "Left a voicemail",
      transcript:
        "Call started.\nPressed 2 to leave a message.\nVoicemail: hello",
      mediaUrls: [TWILIO_URL],
      durationSeconds: 5,
      twilioSid: "CAparent",
    };

    const publicUrls = publicMediaUrls(doc);
    assert.equal(publicUrls.length, 1);
    assert.match(
      publicUrls[0],
      /^\/messaging\/communications\/64b000000000000000000001\/recording\?token=/,
    );
    assert.equal(publicUrls[0].startsWith("/"), true);
    assert.equal(publicUrls[0].includes("://"), false);
    assert.equal(/https?:\/\//i.test(publicUrls[0]), false);
    assert.equal(publicUrls[0].includes("api.twilio.com"), false);
    assert.equal(publicUrls[0].includes("media.twilio.com"), false);
    assert.equal(storedTwilioRecordingUrl(doc.mediaUrls), TWILIO_URL);

    const leaked = JSON.stringify(publicUrls);
    assert.equal(leaked.includes("api.twilio.com"), false);
    assert.equal(leaked.includes("media.twilio.com"), false);
  });

  it("rewrites media.twilio.com voice recordings to the same path-only CRM URL", () => {
    const publicUrls = publicMediaUrls({
      _id: "64b000000000000000000001",
      channel: "voice",
      mediaUrls: [TWILIO_MEDIA_URL],
    });
    assert.equal(publicUrls.length, 1);
    assert.match(
      publicUrls[0],
      /^\/messaging\/communications\/64b000000000000000000001\/recording\?token=/,
    );
    assert.equal(publicUrls[0].includes("media.twilio.com"), false);
    assert.equal(publicUrls[0].includes("://"), false);
  });

  it("strips Twilio URLs from non-voice mediaUrls", () => {
    assert.deepEqual(
      publicMediaUrls({
        _id: "64b000000000000000000001",
        channel: "mms",
        mediaUrls: [TWILIO_URL, "https://cdn.example.com/a.jpg"],
      }),
      ["https://cdn.example.com/a.jpg"],
    );
  });
});
