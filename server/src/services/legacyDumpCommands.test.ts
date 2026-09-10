import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLegacyDumpCommand } from "./legacyDumpCommands";

describe("parseLegacyDumpCommand", () => {
  it("parses help, targets, audit, and counts", () => {
    assert.equal(parseLegacyDumpCommand("help").kind, "help");
    assert.equal(parseLegacyDumpCommand("targets").kind, "targets");
    assert.equal(parseLegacyDumpCommand("audit").kind, "audit");
    assert.deepEqual(parseLegacyDumpCommand("counts"), {
      kind: "counts",
      targets: ["production", "development"],
    });
    assert.deepEqual(parseLegacyDumpCommand("counts development"), {
      kind: "counts",
      targets: ["development"],
    });
  });

  it("parses health, collections, docs, and show", () => {
    assert.equal(parseLegacyDumpCommand("health").kind, "health");
    assert.deepEqual(parseLegacyDumpCommand("collections"), {
      kind: "collections",
      targets: ["production", "development", "mysql"],
    });
    assert.deepEqual(parseLegacyDumpCommand("collections mysql"), {
      kind: "collections",
      targets: ["mysql"],
    });
    assert.deepEqual(parseLegacyDumpCommand("docs customers"), {
      kind: "docs",
      name: "customers",
      target: "development",
      limit: 25,
      skip: 0,
    });
    assert.deepEqual(
      parseLegacyDumpCommand("docs customers production --limit 5 --skip 10"),
      {
        kind: "docs",
        name: "customers",
        target: "production",
        limit: 5,
        skip: 10,
      },
    );
    assert.deepEqual(parseLegacyDumpCommand("show customers 123 mysql"), {
      kind: "show",
      name: "customers",
      id: "123",
      target: "mysql",
    });
  });

  it("rejects invalid reporting commands", () => {
    assert.equal(parseLegacyDumpCommand("health extra").kind, "rejected");
    assert.equal(parseLegacyDumpCommand("docs").kind, "rejected");
    assert.equal(parseLegacyDumpCommand("docs customers --limit").kind, "rejected");
    assert.equal(parseLegacyDumpCommand("show customers").kind, "rejected");
    assert.equal(parseLegacyDumpCommand("collections staging").kind, "rejected");
  });

  it("requires --confirm for production execute", () => {
    assert.equal(parseLegacyDumpCommand("execute development").kind, "execute");
    const missing = parseLegacyDumpCommand("execute production");
    assert.equal(missing.kind, "rejected");
    const confirmed = parseLegacyDumpCommand("execute production --confirm");
    assert.deepEqual(confirmed, {
      kind: "execute",
      production: true,
      development: false,
      confirmProduction: true,
    });
  });

  it("rejects destructive and unknown commands", () => {
    for (const command of [
      "drop customers",
      "delete work_orders",
      "db.dropDatabase()",
      "eval 1",
      "mongo",
      "rm -rf",
      "foo",
    ]) {
      const parsed = parseLegacyDumpCommand(command);
      assert.equal(parsed.kind, "rejected");
    }
  });
});
