import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  fetchTwilioRecordingMedia,
  twilioRecordingMediaUrl,
  TwilioServiceError,
} from "./twilio.service";
import type { ITwilioAccount } from "../models/mongo/TwilioAccount";

describe("twilioRecordingMediaUrl", () => {
  it("appends .mp3 when the stored RecordingUrl has no extension", () => {
    assert.equal(
      twilioRecordingMediaUrl(
        "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx",
      ),
      "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx.mp3",
    );
  });

  it("leaves an existing audio extension alone", () => {
    assert.equal(
      twilioRecordingMediaUrl(
        "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx.wav",
      ),
      "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx.wav",
    );
  });
});

describe("fetchTwilioRecordingMedia", () => {
  it("refuses to proxy a non-Twilio URL", async () => {
    await assert.rejects(
      () =>
        fetchTwilioRecordingMedia({
          account: {
            accountSid: "ACxxx",
            authTokenEncrypted: encryptCredential("secret-token"),
          } as ITwilioAccount,
          recordingUrl: "https://example.com/audio.mp3",
        }),
      TwilioServiceError,
    );
  });

  it("fetches with Twilio basic auth and forwards Range", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(Buffer.from("ID3fake"), {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": "bytes 0-7/8",
          "Content-Length": "8",
          "Accept-Ranges": "bytes",
        },
      });
    }) as typeof fetch;

    try {
      const result = await fetchTwilioRecordingMedia({
        account: {
          accountSid: "ACxxx",
          authTokenEncrypted: encryptCredential("secret-token"),
        } as ITwilioAccount,
        recordingUrl:
          "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx",
        range: "bytes=0-7",
      });
      assert.equal(result.status, 206);
      assert.equal(result.contentType, "audio/mpeg");
      assert.equal(result.contentRange, "bytes 0-7/8");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\.mp3$/);
      const headers = new Headers(calls[0].init?.headers);
      assert.equal(headers.get("Range"), "bytes=0-7");
      assert.match(headers.get("Authorization") || "", /^Basic /);
    } finally {
      globalThis.fetch = original;
    }
  });
});
