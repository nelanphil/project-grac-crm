import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboxListFilter } from "./inboxListFilter";

function has(and: Record<string, unknown>[], key: string): boolean {
  return and.some((clause) => key in clause);
}

describe("inboxListFilter", () => {
  it("hides deleted and other-status chats without a search", () => {
    const and = inboxListFilter({ status: "open", filter: "unread" });
    assert.deepEqual(and[0], { deletedAt: null });
    assert.ok(and.some((clause) => clause.status === "open"));
    assert.ok(has(and, "unreadCount"));
  });

  it("includes deleted and closed chats when searching", () => {
    const and = inboxListFilter({ status: "open", filter: "unread", q: "Dobson" });
    assert.equal(has(and, "deletedAt"), false);
    assert.equal(has(and, "status"), false);
    assert.equal(has(and, "unreadCount"), false);
    assert.ok(and.some((clause) => JSON.stringify(clause) === JSON.stringify({ blocked: { $ne: true } })));
    assert.ok(has(and, "$or"));
    assert.equal(has(and, "lastInboundAt"), false);
  });

  it("matches chats linked to customers found by name", () => {
    const and = inboxListFilter({ q: "Dobson" }, ["c1", "c2"]);
    const or = and.find((clause) => "$or" in clause)?.$or as Record<string, unknown>[];
    assert.deepEqual(or.at(-1), { customerRef: { $in: ["c1", "c2"] } });
  });

  it("matches phone digits typed with punctuation", () => {
    const and = inboxListFilter({ q: "(555) 123" });
    const or = and.find((clause) => "$or" in clause)?.$or as Record<string, unknown>[];
    assert.ok(or.some((clause) => String(clause.handle) === "/555123/"));
  });

  it("keeps the blocked view limited to non-deleted blocked chats", () => {
    const and = inboxListFilter({ blocked: "1", q: "Dobson" });
    assert.deepEqual(and.slice(0, 2), [{ deletedAt: null }, { blocked: true }]);
  });

  it("ignores a whitespace-only search", () => {
    const and = inboxListFilter({ q: "   " });
    assert.deepEqual(and[0], { deletedAt: null });
    assert.equal(has(and, "$or"), false);
  });
});
