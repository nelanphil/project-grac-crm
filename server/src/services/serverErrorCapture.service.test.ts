import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { createRequestId } from "../middleware/requestId";
import {
  bodyKeys,
  errorFingerprint,
  normalizeMessage,
  topStackFrame,
  type ServerErrorInput,
} from "./serverErrorCapture.service";

describe("normalizeMessage", () => {
  it("collapses ids, numbers, and quoted values", () => {
    assert.equal(
      normalizeMessage('Cast to ObjectId failed for value "abc" at 507f1f77bcf86cd799439011 (12)'),
      "Cast to ObjectId failed for value <str> at <id> (<n>)",
    );
  });
});

describe("topStackFrame", () => {
  it("skips node_modules and internal frames", () => {
    const stack = [
      "Error: boom",
      "    at Query.exec (/app/node_modules/mongoose/lib/query.js:10:5)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      "    at listWorkOrders (/app/dist/controllers/workOrder.controller.js:42:11)",
    ].join("\n");
    assert.equal(
      topStackFrame(stack),
      "at listWorkOrders (/app/dist/controllers/workOrder.controller.js",
    );
  });
});

describe("errorFingerprint", () => {
  const stack = "Error\n    at handler (/app/dist/a.js:1:2)";

  it("groups the same bug across different ids and line numbers", () => {
    const a = errorFingerprint({
      name: "Error",
      message: "Work order 507f1f77bcf86cd799439011 not found",
      stack,
      route: "/work-orders/:id",
    });
    const b = errorFingerprint({
      name: "Error",
      message: "Work order 507f191e810c19729de860ea not found",
      stack: "Error\n    at handler (/app/dist/a.js:9:9)",
      route: "/work-orders/:id",
    });
    assert.equal(a, b);
  });

  it("separates different routes", () => {
    const base = { name: "Error", message: "boom", stack };
    assert.notEqual(
      errorFingerprint({ ...base, route: "/a" }),
      errorFingerprint({ ...base, route: "/b" }),
    );
  });
});

describe("bodyKeys", () => {
  it("returns field names only, never values", () => {
    assert.deepEqual(bodyKeys({ email: "a@b.c", password: "secret" }), [
      "email",
      "password",
    ]);
    assert.deepEqual(bodyKeys(["x"]), []);
    assert.deepEqual(bodyKeys(undefined), []);
  });
});

function fakeExchange(headers: Record<string, string> = {}) {
  const req = {
    get: (name: string) => headers[name.toLowerCase()],
    method: "GET",
    originalUrl: "/things",
  } as unknown as Request & { requestId?: string };
  const emitter = new EventEmitter();
  const sentHeaders: Record<string, string> = {};
  const res = Object.assign(emitter, {
    statusCode: 200,
    locals: {} as Record<string, unknown>,
    setHeader: (name: string, value: string) => {
      sentHeaders[name] = value;
    },
    json(this: unknown) {
      return this;
    },
  }) as unknown as Response;
  return { req, res, sentHeaders };
}

describe("requestId middleware", () => {
  it("assigns an id and records 5xx responses with their message", () => {
    const recorded: ServerErrorInput[] = [];
    const middleware = createRequestId(async (input) => {
      recorded.push(input);
    });
    const { req, res, sentHeaders } = fakeExchange();
    let called = false;
    middleware(req, res, (() => {
      called = true;
    }) as NextFunction);

    assert.equal(called, true);
    assert.ok(req.requestId);
    assert.equal(sentHeaders["X-Request-Id"], req.requestId);

    res.statusCode = 500;
    res.json({ message: "Failed to load things." });
    res.emit("finish");
    res.emit("finish");

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].status, 500);
    assert.equal(recorded[0].message, "Failed to load things.");
  });

  it("reuses a well-formed incoming id and ignores 4xx", () => {
    const recorded: ServerErrorInput[] = [];
    const middleware = createRequestId(async (input) => {
      recorded.push(input);
    });
    const { req, res } = fakeExchange({ "x-request-id": "client-abc-12345" });
    middleware(req, res, (() => undefined) as NextFunction);
    assert.equal(req.requestId, "client-abc-12345");

    res.statusCode = 404;
    res.emit("finish");
    assert.equal(recorded.length, 0);
  });

  it("skips responses already recorded by the error handler", () => {
    const recorded: ServerErrorInput[] = [];
    const middleware = createRequestId(async (input) => {
      recorded.push(input);
    });
    const { req, res } = fakeExchange();
    middleware(req, res, (() => undefined) as NextFunction);
    res.statusCode = 500;
    res.locals.crashRecorded = true;
    res.emit("finish");
    assert.equal(recorded.length, 0);
  });
});
