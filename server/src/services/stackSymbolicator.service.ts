import { gunzipSync } from "node:zlib";
import {
  AnyMap,
  originalPositionFor,
  sourceContentFor,
  type TraceMap,
} from "@jridgewell/trace-mapping";
import { SourceMap } from "../models/mongo/SourceMap";

const CACHE_LIMIT = 20;
const SNIPPET_FRAMES = 3;
const SNIPPET_RADIUS = 2;

export interface DecodedFrame {
  raw: string;
  fn: string;
  file: string;
  line: number;
  column: number;
  decoded: boolean;
  snippet?: string;
}

export interface DecodedStack {
  text: string;
  frames: DecodedFrame[];
  /** Number of frames that were mapped back to original source. */
  mapped: number;
}

export type SourceMapLoader = (file: string) => Promise<TraceMap | null>;

const FRAME_LOCATION = /((?:https?:\/\/[^\s()]+?)|(?:\/_next\/[^\s()]+?)):(\d+):(\d+)/;

/** `https://host/_next/static/chunks/a.js?v=1` -> `_next/static/chunks/a.js`. */
export function chunkKey(url: string): string | null {
  const index = url.indexOf("_next/");
  if (index < 0) return null;
  return url.slice(index).split(/[?#]/)[0] || null;
}

export function cleanSourcePath(source: string): string {
  return source
    .replace(/^turbopack:\/\/\/\[project\]\//, "")
    .replace(/^turbopack:\/\/\//, "")
    .replace(/^webpack:\/\/[^/]*\//, "")
    .replace(/^\.\//, "")
    .replace(/^\[project\]\//, "");
}

function frameFunction(line: string): string {
  const chrome = line.match(/^\s*at\s+(.+?)\s+\(/);
  if (chrome) return chrome[1];
  const gecko = line.match(/^\s*([^@\s]*)@/);
  if (gecko && gecko[1]) return gecko[1];
  return "";
}

function isAppSource(file: string): boolean {
  return !file.includes("node_modules") && !file.startsWith("[externals]");
}

function snippetFor(map: TraceMap, source: string, line: number): string | undefined {
  const content = sourceContentFor(map, source);
  if (!content) return undefined;
  const lines = content.split("\n");
  const start = Math.max(1, line - SNIPPET_RADIUS);
  const end = Math.min(lines.length, line + SNIPPET_RADIUS);
  const out: string[] = [];
  for (let n = start; n <= end; n += 1) {
    const marker = n === line ? ">" : " ";
    out.push(`${marker} ${String(n).padStart(5)} | ${lines[n - 1] ?? ""}`);
  }
  return out.join("\n");
}

/** Decodes a minified browser stack using the provided source map loader. */
export async function decodeStackWith(
  stack: string,
  loader: SourceMapLoader,
): Promise<DecodedStack> {
  const maps = new Map<string, TraceMap | null>();
  const frames: DecodedFrame[] = [];
  const out: string[] = [];
  let mapped = 0;
  let snippets = 0;

  for (const rawLine of stack.split("\n")) {
    const match = rawLine.match(FRAME_LOCATION);
    if (!match) {
      out.push(rawLine);
      continue;
    }
    const [, url, lineText, columnText] = match;
    const line = Number(lineText);
    const column = Number(columnText);
    const fn = frameFunction(rawLine);
    const key = chunkKey(url);

    let map: TraceMap | null = null;
    if (key) {
      if (!maps.has(key)) maps.set(key, await loader(key).catch(() => null));
      map = maps.get(key) ?? null;
    }

    const position = map
      ? originalPositionFor(map, { line, column: Math.max(0, column - 1) })
      : null;

    if (map && position && position.source && position.line !== null) {
      const file = cleanSourcePath(position.source);
      const name = position.name || fn;
      const frame: DecodedFrame = {
        raw: rawLine.trim(),
        fn: name,
        file,
        line: position.line,
        column: (position.column ?? 0) + 1,
        decoded: true,
      };
      if (snippets < SNIPPET_FRAMES && isAppSource(file)) {
        frame.snippet = snippetFor(map, position.source, position.line);
        if (frame.snippet) snippets += 1;
      }
      frames.push(frame);
      mapped += 1;
      const where = `${file}:${frame.line}:${frame.column}`;
      out.push(name ? `    at ${name} (${where})` : `    at ${where}`);
    } else {
      frames.push({
        raw: rawLine.trim(),
        fn,
        file: url,
        line,
        column,
        decoded: false,
      });
      out.push(rawLine);
    }
  }

  return { text: out.join("\n"), frames, mapped };
}

const cache = new Map<string, TraceMap | null>();

function remember(file: string, map: TraceMap | null): void {
  cache.delete(file);
  cache.set(file, map);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function forgetSourceMap(file: string): void {
  cache.delete(file);
}

export function parseSourceMap(json: string): TraceMap {
  return new AnyMap(json) as TraceMap;
}

const mongoLoader: SourceMapLoader = async (file) => {
  if (cache.has(file)) {
    const hit = cache.get(file) ?? null;
    remember(file, hit);
    return hit;
  }
  const doc = await SourceMap.findOne({ file });
  const map = doc
    ? parseSourceMap(gunzipSync(doc.content).toString("utf8"))
    : null;
  remember(file, map);
  return map;
};

export async function decodeStack(stack: string): Promise<DecodedStack> {
  return decodeStackWith(stack, mongoLoader);
}
