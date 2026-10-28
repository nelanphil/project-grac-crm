import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  crashReportToMarkdown,
  fence,
  formatBreadcrumb,
  startingPoints,
} from "../src/lib/crashReportExport.ts";
import { redactUrl } from "../src/lib/crashBreadcrumbs.ts";

const occurredAt = "2026-10-27T20:00:10.000Z";
const crashAt = Date.parse(occurredAt);

function report(overrides = {}) {
  return {
    id: "r1",
    status: "open",
    origin: "client",
    source: "render",
    name: "TypeError",
    message: "Cannot read properties of undefined (reading 'total')",
    pathname: "/dashboard/work-orders/1",
    userEmail: "tech@example.com",
    userRole: "technician",
    reporterEmail: "",
    occurredAt,
    createdAt: occurredAt,
    resolvedAt: null,
    occurrences: 1,
    lastSeenAt: null,
    httpStatus: null,
    clientReportId: "c1",
    release: "abc123",
    stack: "TypeError: x\n    at e (https://app/_next/static/chunks/a.js:1:200)",
    decodedStack: "TypeError: x\n    at WorkOrderPanel (src/components/WorkOrderPanel.tsx:42:7)",
    decodedFrames: [
      {
        raw: "at e (https://app/_next/static/chunks/a.js:1:200)",
        fn: "WorkOrderPanel",
        file: "src/components/WorkOrderPanel.tsx",
        line: 42,
        column: 7,
        decoded: true,
        snippet: ">    42 | const total = order.invoice.total;",
      },
    ],
    sourceMapsFound: 1,
    componentStack: "\n    at WorkOrderPanel\n    at Dashboard",
    causes: [],
    context: {},
    additionalErrors: [],
    url: "https://app/dashboard/work-orders/1",
    userAgent: "UA",
    viewport: "390x844",
    online: true,
    environment: { timezone: "America/New_York" },
    whatWereYouDoing: "Completing a job",
    whatHappened: "",
    breadcrumbs: [
      { t: crashAt - 5000, type: "route", detail: "/dashboard/work-orders/1" },
      { t: crashAt - 2000, type: "click", detail: "button: Complete" },
      {
        t: crashAt - 1500,
        type: "api",
        detail: "PATCH /work-orders/1/complete 500",
        meta: { status: 500, durationMs: 840, requestId: "req-1", message: "Failed" },
      },
    ],
    requestId: "",
    requestIds: [],
    http: null,
    fingerprint: "",
    resolutionNote: "",
    resolvedByName: "",
    ip: "",
    relatedServerErrors: [],
    relatedClientReports: [],
    ...overrides,
  };
}

describe("fence", () => {
  it("uses a fence longer than any backtick run in the content", () => {
    assert.equal(fence("a ``` b"), "````text\na ``` b\n````");
  });
});

describe("formatBreadcrumb", () => {
  it("shows relative time, duration, request id, and message", () => {
    const line = formatBreadcrumb(report().breadcrumbs[2], crashAt);
    assert.match(line, /-1\.5s/);
    assert.match(line, /\(840ms\)/);
    assert.match(line, /req=req-1/);
    assert.match(line, /"Failed"/);
  });
});

describe("crashReportToMarkdown", () => {
  it("includes the decoded stack, raw stack, timeline, and starting points", () => {
    const md = crashReportToMarkdown(report(), { link: "https://crm/x" });
    assert.match(md, /^# Crash report r1/);
    assert.match(md, /## Stack \(decoded with source maps\)/);
    assert.match(md, /WorkOrderPanel\.tsx:42:7/);
    assert.match(md, /<details><summary>Raw minified stack/);
    assert.match(md, /## Timeline \(3 events/);
    assert.match(md, /## Starting points/);
    assert.match(md, /\| Link \| https:\/\/crm\/x \|/);
    assert.match(md, /\*\*What happened:\*\* _\(not provided\)_/);
  });

  it("includes linked server errors", () => {
    const md = crashReportToMarkdown(
      report({
        relatedServerErrors: [
          {
            ...report(),
            id: "s1",
            origin: "server",
            source: "server",
            name: "CastError",
            message: "bad id",
            stack: "CastError: bad id\n    at handler (/app/a.js:1:1)",
            http: { method: "PATCH", route: "/work-orders/:id/complete", path: "", status: 500, bodyKeys: ["items"] },
            requestIds: ["req-1"],
            occurrences: 3,
          },
        ],
      }),
    );
    assert.match(md, /## Related server errors/);
    assert.match(md, /PATCH \/work-orders\/:id\/complete -> 500/);
    assert.match(md, /Seen 3 times/);
  });
});

describe("startingPoints", () => {
  it("points at the first app frame and the failing API call", () => {
    const points = startingPoints(report());
    assert.ok(points.some((p) => p.includes("WorkOrderPanel.tsx:42:7")));
    assert.ok(points.some((p) => p.includes("PATCH /work-orders/1/complete 500")));
  });

  it("explains minified stacks when no maps were found", () => {
    const points = startingPoints(
      report({ decodedFrames: [], decodedStack: "", sourceMapsFound: 0 }),
    );
    assert.ok(points.some((p) => p.includes("still minified") && p.includes("abc123")));
  });
});

describe("redactUrl", () => {
  it("redacts sensitive query params and keeps the rest", () => {
    assert.equal(
      redactUrl("https://app/reset?token=abc&step=2#top"),
      "https://app/reset?token=[redacted]&step=2#top",
    );
    assert.equal(redactUrl("/plain/path"), "/plain/path");
  });
});
