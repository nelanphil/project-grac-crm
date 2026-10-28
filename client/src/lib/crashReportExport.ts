import type {
  CrashReportBreadcrumb,
  CrashReportDetail,
  CrashReportErrorPart,
} from "./api";

type RelatedServerError = CrashReportDetail["relatedServerErrors"][number];

/** Wraps text in a code fence longer than any backtick run inside it. */
export function fence(content: string, lang = "text"): string {
  const runs = content.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${content.replace(/\s+$/, "")}\n${ticks}`;
}

function cell(value: unknown): string {
  const text = value === undefined || value === null || value === "" ? "—" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function inlineCode(value: string): string {
  const clean = value.replace(/\r?\n/g, " ");
  return clean.includes("`") ? `\`\` ${clean} \`\`` : `\`${clean}\``;
}

function formatIso(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function relativeSeconds(t: number, crashAt: number): string {
  if (!Number.isFinite(crashAt)) return "";
  const delta = (t - crashAt) / 1000;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : " ";
  return `${sign}${Math.abs(delta).toFixed(1)}s`;
}

export function isFailingApi(item: CrashReportBreadcrumb): boolean {
  if (item.type !== "api") return false;
  const status = item.meta?.status ?? Number(item.detail.split(" ").pop());
  return status === 0 || status >= 400;
}

export function formatBreadcrumb(item: CrashReportBreadcrumb, crashAt: number): string {
  const parts = [relativeSeconds(item.t, crashAt).padStart(8), item.type.padEnd(9), item.detail];
  if (item.meta?.durationMs !== undefined) parts.push(`(${item.meta.durationMs}ms)`);
  if (item.meta?.requestId) parts.push(`req=${item.meta.requestId}`);
  if (item.meta?.message) parts.push(JSON.stringify(item.meta.message));
  return parts.join("  ").trimEnd();
}

function errorTitle(part: { name: string; message: string }): string {
  return `${part.name || "Error"}: ${part.message || "(no message)"}`;
}

function firstAppFrame(report: CrashReportDetail) {
  return report.decodedFrames.find(
    (frame) => frame.decoded && !frame.file.includes("node_modules"),
  );
}

function errorPartsSection(title: string, parts: CrashReportErrorPart[]): string[] {
  if (parts.length === 0) return [];
  const out = [`## ${title}`, ""];
  parts.forEach((part, index) => {
    out.push(`${index + 1}. ${inlineCode(errorTitle(part))}`);
    if (part.stack) out.push("", fence(part.stack), "");
  });
  out.push("");
  return out;
}

function serverErrorSection(items: RelatedServerError[]): string[] {
  if (items.length === 0) return [];
  const out = ["## Related server errors", ""];
  for (const item of items) {
    const http = item.http
      ? `${item.http.method} ${item.http.route || item.http.path} -> ${item.http.status}`
      : "";
    out.push(`### ${errorTitle(item)}`, "");
    out.push(`- Report: ${item.id}`);
    if (http) out.push(`- Request: ${inlineCode(http)}`);
    if (item.occurrences > 1) {
      out.push(`- Seen ${item.occurrences} times (last ${formatIso(item.lastSeenAt)})`);
    }
    if (item.http?.bodyKeys.length) {
      out.push(`- Body fields: ${item.http.bodyKeys.map(inlineCode).join(", ")}`);
    }
    if (item.requestIds.length) {
      out.push(`- Request IDs: ${item.requestIds.slice(-5).join(", ")}`);
    }
    out.push("");
    if (item.stack) out.push(fence(item.stack), "");
  }
  return out;
}

/** Bullet points an engineer can start a debugging plan from. */
export function startingPoints(report: CrashReportDetail): string[] {
  const points: string[] = [];
  const appFrame = firstAppFrame(report);
  if (appFrame) {
    points.push(
      `Start at ${inlineCode(`${appFrame.file}:${appFrame.line}:${appFrame.column}`)}${appFrame.fn ? ` in ${inlineCode(appFrame.fn)}` : ""}.`,
    );
  } else if (report.origin !== "server" && report.stack) {
    points.push(
      report.release
        ? `Stack is still minified. Decode it locally against release ${inlineCode(report.release)}, or upload that build's source maps.`
        : "Stack is still minified and no release was recorded. Match chunk names against a local build to decode it.",
    );
  }

  if (report.origin === "server" && report.http) {
    points.push(
      `Reproduce ${inlineCode(`${report.http.method} ${report.http.route || report.http.path}`)} (returned ${report.http.status}).`,
    );
  }

  const failing = report.breadcrumbs.filter(isFailingApi);
  if (failing.length > 0) {
    const last = failing[failing.length - 1];
    points.push(
      `${failing.length} API call(s) failed before the crash. Last: ${inlineCode(last.detail)}${last.meta?.message ? ` with ${JSON.stringify(last.meta.message)}` : ""}.`,
    );
  }

  if (report.relatedServerErrors.length > 0) {
    points.push(
      `Check the ${report.relatedServerErrors.length} linked server error(s) below; the UI crash may be a symptom.`,
    );
  }

  if (report.source === "chunk") {
    points.push(
      "Chunk load failure: likely a deploy happened while the tab was open, or a network/CDN issue. Compare release with the current build.",
    );
  }
  if (!report.online) points.push("The device reported it was offline at the time.");
  if (report.componentStack) {
    const component = report.componentStack
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("at "));
    if (component) points.push(`Render failed inside ${inlineCode(component.slice(3))}.`);
  }
  if (report.additionalErrors.length > 0) {
    points.push(`${report.additionalErrors.length} more error(s) followed the first one.`);
  }

  const lastRoute = [...report.breadcrumbs].reverse().find((item) => item.type === "route");
  const lastClick = [...report.breadcrumbs].reverse().find((item) => item.type === "click");
  if (lastRoute || lastClick) {
    points.push(
      `To reproduce: open ${inlineCode(lastRoute?.detail ?? report.pathname ?? "/")}${lastClick ? ` then ${inlineCode(lastClick.detail)}` : ""} as a ${report.userRole || "user"}.`,
    );
  }
  return points;
}

export function crashReportToMarkdown(
  report: CrashReportDetail,
  options?: { link?: string },
): string {
  const crashAt = new Date(report.occurredAt).getTime();
  const lines: string[] = [];

  lines.push(`# Crash report ${report.id}`, "");
  lines.push(`**${inlineCode(errorTitle(report))}**`, "");

  const summary: [string, unknown][] = [
    ["Status", report.status],
    ["Origin / source", `${report.origin} / ${report.source}`],
    ["Release", report.release],
    ["Occurred", formatIso(report.occurredAt)],
    ["User", `${report.userEmail || report.reporterEmail || "Anonymous"}${report.userRole ? ` (${report.userRole})` : ""}`],
    ["Page", report.url || report.pathname],
  ];
  if (report.occurrences > 1) {
    summary.push(["Occurrences", `${report.occurrences} (last ${formatIso(report.lastSeenAt)})`]);
  }
  if (report.http) {
    summary.push([
      "Request",
      `${report.http.method} ${report.http.route || report.http.path} -> ${report.http.status}`,
    ]);
  }
  if (report.requestId) summary.push(["Request ID", report.requestId]);
  if (options?.link) summary.push(["Link", options.link]);

  lines.push("| Field | Value |", "| --- | --- |");
  for (const [key, value] of summary) lines.push(`| ${key} | ${cell(value)} |`);
  lines.push("");

  if (report.origin !== "server") {
    lines.push("## What the user said", "");
    lines.push(`**Doing:** ${report.whatWereYouDoing || "_(not provided)_"}`, "");
    lines.push(`**What happened:** ${report.whatHappened || "_(not provided)_"}`, "");
  }

  if (report.decodedStack && report.sourceMapsFound > 0) {
    lines.push("## Stack (decoded with source maps)", "", fence(report.decodedStack), "");
    lines.push("<details><summary>Raw minified stack</summary>", "", fence(report.stack), "", "</details>", "");
    const snippets = report.decodedFrames.filter((frame) => frame.snippet);
    if (snippets.length > 0) {
      lines.push("### Source near the top frames", "");
      for (const frame of snippets) {
        lines.push(`${inlineCode(`${frame.file}:${frame.line}`)}${frame.fn ? ` in ${inlineCode(frame.fn)}` : ""}`, "");
        lines.push(fence(frame.snippet ?? ""), "");
      }
    }
  } else if (report.stack) {
    const heading =
      report.origin === "server" ? "## Stack" : "## Stack (minified, no source maps found)";
    lines.push(heading, "", fence(report.stack), "");
  } else {
    lines.push("## Stack", "", "_No stack was captured._", "");
  }

  const contextEntries = Object.entries(report.context ?? {});
  if (contextEntries.length > 0) {
    lines.push("## Error context", "", "| Field | Value |", "| --- | --- |");
    for (const [key, value] of contextEntries) lines.push(`| ${key} | ${cell(value)} |`);
    lines.push("");
  }

  lines.push(...errorPartsSection("Cause chain", report.causes));
  lines.push(
    ...errorPartsSection(
      "Additional errors after the first",
      report.additionalErrors.map((item) => ({
        ...item,
        name: `[${item.source} ${formatIso(item.at)}] ${item.name}`,
      })),
    ),
  );

  if (report.componentStack) {
    lines.push("## Component stack", "", fence(report.componentStack), "");
  }

  if (report.breadcrumbs.length > 0) {
    lines.push(
      `## Timeline (${report.breadcrumbs.length} events, times relative to the crash)`,
      "",
      fence(report.breadcrumbs.map((item) => formatBreadcrumb(item, crashAt)).join("\n")),
      "",
    );
  }

  lines.push(...serverErrorSection(report.relatedServerErrors));

  if (report.relatedClientReports.length > 0) {
    lines.push("## Browser reports that hit this error", "");
    for (const item of report.relatedClientReports) {
      lines.push(`- ${item.id}: ${inlineCode(errorTitle(item))} on ${item.pathname || "—"} (${formatIso(item.occurredAt)})`);
    }
    lines.push("");
  }

  const environment: [string, unknown][] = [
    ["Viewport", report.viewport],
    ["Online", report.online ? "yes" : "no"],
    ["Browser", report.userAgent],
    ...Object.entries(report.environment ?? {}),
  ];
  if (report.http?.bodyKeys.length) {
    environment.push(["Request body fields", report.http.bodyKeys.join(", ")]);
  }
  if (report.fingerprint) environment.push(["Fingerprint", report.fingerprint]);
  if (report.clientReportId) environment.push(["Client report ID", report.clientReportId]);
  lines.push("## Environment", "", "| Field | Value |", "| --- | --- |");
  for (const [key, value] of environment) lines.push(`| ${key} | ${cell(value)} |`);
  lines.push("");

  const points = startingPoints(report);
  if (points.length > 0) {
    lines.push("## Starting points", "");
    for (const point of points) lines.push(`- [ ] ${point}`);
    lines.push("");
  }

  if (report.resolutionNote) {
    lines.push("## Resolution note", "", report.resolutionNote, "");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Copies text, falling back to a hidden textarea where the Clipboard API is unavailable. */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } finally {
    document.body.removeChild(area);
  }
}

export function downloadText(filename: string, text: string, type = "text/markdown"): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
