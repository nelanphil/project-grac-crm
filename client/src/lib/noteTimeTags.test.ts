import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { earlierTimeFloor, suggestTimeTokens } from "./noteTimeTags";

describe("suggestTimeTokens", () => {
  it("offers the top of the hour, then each matching minute", () => {
    assert.deepEqual(
      suggestTimeTokens("9").map((choice) => choice.label),
      ["9:00 AM", "9:00 PM"],
    );
    assert.deepEqual(
      suggestTimeTokens("9:3").map((choice) => choice.token),
      [
        "@9:30AM",
        "@9:31AM",
        "@9:32AM",
        "@9:33AM",
        "@9:34AM",
        "@9:35AM",
        "@9:36AM",
        "@9:37AM",
        "@9:38AM",
        "@9:39AM",
        "@9:30PM",
        "@9:31PM",
        "@9:32PM",
        "@9:33PM",
        "@9:34PM",
        "@9:35PM",
        "@9:36PM",
        "@9:37PM",
        "@9:38PM",
        "@9:39PM",
      ],
    );
    assert.deepEqual(
      suggestTimeTokens("9:34").map((choice) => choice.label),
      ["9:34 AM", "9:34 PM"],
    );
  });

  it("hides a second time that is not after the first tag", () => {
    assert.equal(earlierTimeFloor("Come @8:00AM "), "08:00");
    assert.deepEqual(
      suggestTimeTokens("7", "08:00").map((choice) => choice.label),
      ["7:00 PM"],
    );
    assert.deepEqual(
      suggestTimeTokens("8:0", "08:00").map((choice) => choice.label).slice(0, 2),
      ["8:01 AM", "8:02 AM"],
    );
    assert.deepEqual(
      suggestTimeTokens("8:00", "08:00").map((choice) => choice.label),
      ["8:00 PM"],
    );
    assert.deepEqual(
      suggestTimeTokens("9:34", "08:00").map((choice) => choice.label),
      ["9:34 AM", "9:34 PM"],
    );
    assert.deepEqual(
      suggestTimeTokens("8", "08:34").map((choice) => choice.label),
      ["8:45 AM", "8:00 PM"],
    );
  });
});
