import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVoiceWebhookBase } from "./publicUrl";

describe("resolveVoiceWebhookBase", () => {
  it("keeps a public API host and ignores a tunnel override", () => {
    assert.equal(
      resolveVoiceWebhookBase("https://api.example.com", "https://tunnel.example.com"),
      "https://api.example.com",
    );
  });

  it("uses the origin of a public tunnel when the API is local", () => {
    assert.equal(
      resolveVoiceWebhookBase(
        "http://localhost:4009",
        "https://grac.ngrok-free.app/extra",
      ),
      "https://grac.ngrok-free.app",
    );
  });

  it("rejects a local override", () => {
    assert.equal(
      resolveVoiceWebhookBase("http://127.0.0.1:4009", "http://localhost:4009"),
      null,
    );
  });
});
