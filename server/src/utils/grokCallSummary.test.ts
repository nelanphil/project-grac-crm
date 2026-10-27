import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGrokCallSummary } from "./grokCallSummary";

describe("parseGrokCallSummary", () => {
  it("reads a summary and a suggested task", () => {
    const parsed = parseGrokCallSummary(
      'Here is the result {"summary":"Customer needs a callback.","task":{"needed":true,"title":"Call back","description":"Schedule the visit","dueInDays":1}}',
    );
    assert.equal(parsed?.summary, "Customer needs a callback.");
    assert.equal(parsed?.task.needed, true);
    assert.equal(parsed?.task.title, "Call back");
    assert.equal(parsed?.task.dueInDays, 1);
  });

  it("rejects a response that is not the expected shape", () => {
    assert.equal(parseGrokCallSummary('{"summary":""}'), null);
    assert.equal(parseGrokCallSummary("not json"), null);
    assert.equal(
      parseGrokCallSummary('{"summary":"Ok","task":{"needed":"yes","title":"Call"}}'),
      null,
    );
  });
});
