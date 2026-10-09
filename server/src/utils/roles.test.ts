import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignableRoles,
  hasRole,
  isCustomerRole,
  isDispatcherRole,
  isStaffUser,
  normalizeRoles,
  primaryRole,
  RoleAssignmentError,
  rolesFromPayload,
  syncRoleFields,
} from "./roles";

describe("normalizeRoles", () => {
  it("accepts a string, array, or user-like object", () => {
    assert.deepEqual(normalizeRoles("tech"), ["tech"]);
    assert.deepEqual(normalizeRoles(["manager", "tech", "tech"]), [
      "manager",
      "tech",
    ]);
    assert.deepEqual(normalizeRoles({ role: "agent" }), ["agent"]);
    assert.deepEqual(
      normalizeRoles({ role: "agent", roles: ["manager", "tech"] }),
      ["manager", "tech"],
    );
  });
});

describe("primaryRole", () => {
  it("picks the highest-ranked system role", () => {
    assert.equal(primaryRole(["agent", "manager"]), "manager");
    assert.equal(primaryRole(["admin", "agent"]), "admin");
    assert.equal(primaryRole(["custom", "agent"]), "agent");
    assert.equal(primaryRole(["lead-tech"]), "lead-tech");
  });
});

describe("hasRole helpers", () => {
  it("matches any assigned role", () => {
    const user = { role: "manager", roles: ["manager", "agent"] };
    assert.equal(hasRole(user, "agent"), true);
    assert.equal(isStaffUser(user), true);
    assert.equal(isStaffUser({ userType: "customer", roles: ["admin"] }), false);
    assert.equal(isDispatcherRole(user), false);
    assert.equal(isDispatcherRole({ roles: ["admin", "agent"] }), true);
    assert.equal(isCustomerRole({ roles: ["customer"] }), true);
    assert.equal(isCustomerRole({ userType: "staff", roles: ["customer"] }), false);
  });
});

describe("assignableRoles", () => {
  it("rejects an empty set and mixed customer+staff", () => {
    assert.throws(() => assignableRoles([]), RoleAssignmentError);
    assert.throws(
      () => assignableRoles(["customer", "tech"]),
      RoleAssignmentError,
    );
    assert.deepEqual(assignableRoles(["manager", "tech"]), ["manager", "tech"]);
  });
});

describe("rolesFromPayload / syncRoleFields", () => {
  it("prefers roles[] over a single role", () => {
    assert.deepEqual(
      rolesFromPayload({ role: "agent", roles: ["manager", "tech"] }),
      ["manager", "tech"],
    );
    assert.deepEqual(syncRoleFields({ roles: ["tech", "manager"] }), {
      roles: ["tech", "manager"],
      role: "manager",
    });
    assert.deepEqual(syncRoleFields({ roles: ["customer", "tech"] }), {
      roles: ["customer"],
      role: "customer",
    });
  });
});
