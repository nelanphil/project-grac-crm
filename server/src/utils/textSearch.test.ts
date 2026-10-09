import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTokenSearchFilter, searchTokens } from "./textSearch";

type Clause = { $or: Array<Record<string, RegExp>> };

describe("searchTokens", () => {
  it("splits on any whitespace and drops blanks", () => {
    assert.deepEqual(searchTokens("  Ryan \t James  "), ["Ryan", "James"]);
    assert.deepEqual(searchTokens("   "), []);
  });
});

describe("buildTokenSearchFilter", () => {
  it("returns null for empty input or no fields", () => {
    assert.equal(buildTokenSearchFilter("", ["first"]), null);
    assert.equal(buildTokenSearchFilter("   ", ["first"]), null);
    assert.equal(buildTokenSearchFilter("Ryan", []), null);
  });

  it("returns a single $or clause for one token", () => {
    const filter = buildTokenSearchFilter("Ryan", ["first", "last"]) as Clause;
    assert.equal(filter.$or.length, 2);
    assert.ok(filter.$or[0]!.first!.test("ryan"));
    assert.ok(filter.$or[1]!.last!.test("RYAN"));
  });

  it("requires every token to match some field", () => {
    const filter = buildTokenSearchFilter("Ryan James", ["first", "last"]) as {
      $and: Clause[];
    };
    assert.equal(filter.$and.length, 2);
    const [ryan, james] = filter.$and;
    assert.ok(ryan!.$or[0]!.first!.test("Ryan"));
    assert.ok(!ryan!.$or[0]!.first!.test("Ryan James".replace("Ryan", "Bob")));
    assert.ok(james!.$or[1]!.last!.test("James"));
  });

  it("escapes regex characters in tokens", () => {
    const filter = buildTokenSearchFilter("a.b (c)", ["accountName"]) as {
      $and: Clause[];
    };
    const dot = filter.$and[0]!.$or[0]!.accountName!;
    assert.ok(dot.test("a.b"));
    assert.ok(!dot.test("axb"));
    const paren = filter.$and[1]!.$or[0]!.accountName!;
    assert.ok(paren.test("(c)"));
  });
});
