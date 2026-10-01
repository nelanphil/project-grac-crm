import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNonPublicIp,
  isValidCoordinates,
  locationFromGoogleGeocode,
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
      { city: "Orlando", region: "FL", country: "United States", source: "ip" },
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
      { city: "Paris", region: "Île-de-France", country: "France", source: "ip" },
    );
  });
});

describe("locationFromGoogleGeocode", () => {
  it("reads city, state code, and country from the first result", () => {
    assert.deepEqual(
      locationFromGoogleGeocode({
        status: "OK",
        results: [
          {
            address_components: [
              { long_name: "DeLand", short_name: "DeLand", types: ["locality", "political"] },
              { long_name: "Volusia County", short_name: "Volusia County", types: ["administrative_area_level_2", "political"] },
              { long_name: "Florida", short_name: "FL", types: ["administrative_area_level_1", "political"] },
              { long_name: "United States", short_name: "US", types: ["country", "political"] },
            ],
          },
        ],
      }),
      { city: "DeLand", region: "FL", country: "United States", source: "device" },
    );
  });

  it("returns null for errors and empty results", () => {
    assert.equal(locationFromGoogleGeocode({ status: "REQUEST_DENIED" }), null);
    assert.equal(locationFromGoogleGeocode({ status: "ZERO_RESULTS", results: [] }), null);
    assert.equal(
      locationFromGoogleGeocode({
        status: "OK",
        results: [{ address_components: [{ long_name: "United States", types: ["country"] }] }],
      }),
      null,
    );
  });
});

describe("isValidCoordinates", () => {
  it("accepts real coordinates and rejects out-of-range values", () => {
    assert.equal(isValidCoordinates(29.028, -81.303), true);
    assert.equal(isValidCoordinates(91, 0), false);
    assert.equal(isValidCoordinates(0, -181), false);
    assert.equal(isValidCoordinates(Number.NaN, 0), false);
  });
});
