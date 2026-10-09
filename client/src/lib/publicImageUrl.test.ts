import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicImageOrigin, publicImageUrl } from "./publicImageUrl";

describe("publicImageUrl", () => {
  it("builds a client /images/<slug> path from an origin", () => {
    assert.equal(
      publicImageUrl("sign-up-opt-in-auth", "https://genmaintoffl.com"),
      "https://genmaintoffl.com/images/sign-up-opt-in-auth",
    );
  });

  it("does not use the API /public-assets host", () => {
    const url = publicImageUrl("mu2w30e-1qj5dfx", "https://genmaintoffl.com");
    assert.equal(url.includes("gmof-server.onrender.com"), false);
    assert.equal(url.includes("/public-assets/"), false);
    assert.match(url, /\/images\/mu2w30e-1qj5dfx$/);
  });

  it("returns a root-relative client path when no origin is available", () => {
    assert.equal(publicImageUrl("demo-slug"), "/images/demo-slug");
  });

  it("trims trailing slashes on the origin", () => {
    assert.equal(
      publicImageOrigin("https://genmaintoffl.com/"),
      "https://genmaintoffl.com",
    );
  });
});
