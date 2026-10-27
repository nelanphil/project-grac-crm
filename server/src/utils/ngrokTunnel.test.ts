import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicBaseForLocalPort } from "./ngrokTunnel";

describe("publicBaseForLocalPort", () => {
  it("prefers the https tunnel for this API port", () => {
    assert.equal(
      publicBaseForLocalPort(
        [
          {
            public_url: "http://old.ngrok-free.app",
            config: { addr: "http://localhost:4009" },
          },
          {
            public_url: "https://fresh.ngrok-free.app",
            config: { addr: "http://localhost:4009" },
          },
          {
            public_url: "https://other.ngrok-free.app",
            config: { addr: "http://localhost:3009" },
          },
        ],
        4009,
      ),
      "https://fresh.ngrok-free.app",
    );
  });

  it("returns null when ngrok is not forwarding this port", () => {
    assert.equal(
      publicBaseForLocalPort(
        [{ public_url: "https://fresh.ngrok-free.app", config: { addr: "http://localhost:3000" } }],
        4009,
      ),
      null,
    );
  });
});
