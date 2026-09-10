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
