import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySmsOptOut } from "../utils/smsOptOut";

describe("classifySmsOptOut", () => {
  it("treats a whole-message keyword as an automatic opt-out", () => {
    assert.deepEqual(classifySmsOptOut("STOP"), {
      kind: "keyword",
      matched: "STOP",
    });
    assert.equal(classifySmsOptOut("stop!!")?.kind, "keyword");
    assert.equal(classifySmsOptOut("Unsubscribe.")?.matched, "UNSUBSCRIBE");
    assert.equal(classifySmsOptOut("OPT-OUT")?.matched, "OPTOUT");
    assert.equal(classifySmsOptOut("  end  ")?.kind, "keyword");
  });

  it("treats START, UNSTOP, and YES as opt-in", () => {
    assert.equal(classifySmsOptOut("START")?.kind, "start");
    assert.equal(classifySmsOptOut("unstop")?.kind, "start");
    assert.equal(classifySmsOptOut("Yes!")?.kind, "start");
  });

  it("flags longer opt-out requests without applying them", () => {
    assert.equal(classifySmsOptOut("STOP TEXTING ME")?.kind, "phrase");
    assert.equal(classifySmsOptOut("please unsubscribe me")?.kind, "phrase");
    assert.equal(classifySmsOptOut("Don't text me anymore")?.kind, "phrase");
    assert.equal(classifySmsOptOut("no more texts")?.kind, "phrase");
    assert.match(classifySmsOptOut("remove me from your list")?.matched ?? "", /remove me/);
  });

  it("ignores ordinary messages", () => {
    assert.equal(classifySmsOptOut(""), null);
    assert.equal(classifySmsOptOut("yes I'll be home at 3"), null);
    assert.equal(classifySmsOptOut("please cancel my appointment"), null);
    assert.equal(classifySmsOptOut("the end of the driveway"), null);
  });
});
