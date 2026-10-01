import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNonPublicIp,
  locationFromLookup,
  normalizeClientIp,
} from "./loginLocation";

describe("normalizeClientIp", () => {
  it("strips the IPv4-mapped prefix", () => {
    assert.equal(normalizeClientIp("::ffff:8.8.8.8"), "8.8.8.8");
    assert.equal(normalizeClientIp(" 8.8.8.8 "), "8.8.8.8");
    assert.equal(normalizeClientIp(null), "");
  });
});

describe("isNonPublicIp", () => {
  it("treats loopback and private ranges as non-public", () => {
    assert.equal(isNonPublicIp(""), true);
    assert.equal(isNonPublicIp("127.0.0.1"), true);
    assert.equal(isNonPublicIp("::1"), true);
    assert.equal(isNonPublicIp("::ffff:192.168.1.10"), true);
    assert.equal(isNonPublicIp("10.1.2.3"), true);
    assert.equal(isNonPublicIp("172.16.0.1"), true);
    assert.equal(isNonPublicIp("172.32.0.1"), false);
    assert.equal(isNonPublicIp("8.8.8.8"), false);
  });

  it("treats the full fe80::/10 link-local range as non-public", () => {
    assert.equal(isNonPublicIp("fe80::1"), true);
    assert.equal(isNonPublicIp("fea0::1"), true);
    assert.equal(isNonPublicIp("feb0::1"), true);
    assert.equal(isNonPublicIp("febf::1"), true);
    assert.equal(isNonPublicIp("FEA0::1"), true);
    assert.equal(isNonPublicIp("fe7f::1"), false);
    assert.equal(isNonPublicIp("fec0::1"), false);
    assert.equal(isNonPublicIp("2001:4860:4860::8888"), false);
  });
});

describe("locationFromLookup", () => {
  it("prefers the region code and ignores failed lookups", () => {
    assert.deepEqual(
      locationFromLookup({
        success: true,
        city: "Orlando",
        region: "Florida",
        region_code: "FL",
        country: "United States",
      }),
      { city: "Orlando", region: "FL", country: "United States" },
    );
    assert.equal(locationFromLookup({ success: false, city: "Orlando" }), null);
    assert.equal(locationFromLookup({ success: true }), null);
  });

  it("falls back to the region name when there is no code", () => {
    assert.deepEqual(
      locationFromLookup({
        city: "Paris",
        region: "Île-de-France",
        country: "France",
      }),
      { city: "Paris", region: "Île-de-France", country: "France" },
    );
  });
});
