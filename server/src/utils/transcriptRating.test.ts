import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTranscriptRating } from "./transcriptRating";

describe("parseTranscriptRating", () => {
  it("accepts 1 to 5 stars and trims the comment", () => {
    assert.deepEqual(parseTranscriptRating({ stars: 4, comment: "  missed a name  " }), {
      stars: 4,
      comment: "missed a name",
    });
    assert.deepEqual(parseTranscriptRating({ stars: "1" }), { stars: 1, comment: "" });
  });

  it("rejects ratings outside 1 to 5", () => {
    assert.equal(parseTranscriptRating({ stars: 0 }), null);
    assert.equal(parseTranscriptRating({ stars: 6 }), null);
    assert.equal(parseTranscriptRating({ stars: 1.5 }), null);
    assert.equal(parseTranscriptRating({ stars: "five" }), null);
  });

  it("caps a long comment", () => {
    const comment = "x".repeat(800);
    const parsed = parseTranscriptRating({ stars: 3, comment });
    assert.equal(parsed?.comment.length, 500);
  });
});
