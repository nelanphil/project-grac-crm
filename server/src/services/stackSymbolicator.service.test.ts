import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkKey,
  cleanSourcePath,
  decodeStackWith,
  parseSourceMap,
} from "./stackSymbolicator.service";

// Generated line 1 col 0 -> Foo.tsx 1:0 (name "handleSave");
// generated line 2 col 0 -> Foo.tsx 2:0.
const fixtureMap = JSON.stringify({
  version: 3,
  file: "abc.js",
  sources: ["turbopack:///[project]/src/components/Foo.tsx"],
  sourcesContent: [
    "function handleSave() {\n  throw new Error('boom');\n}\nexport default handleSave;\n",
  ],
  names: ["handleSave"],
  mappings: "AAAAA;AACA",
});

const loader = async (file: string) =>
  file === "_next/static/chunks/abc.js" ? parseSourceMap(fixtureMap) : null;

describe("chunkKey", () => {
  it("extracts the site-relative chunk path", () => {
    assert.equal(
      chunkKey("https://app.example.com/_next/static/chunks/abc.js?v=1"),
      "_next/static/chunks/abc.js",
    );
    assert.equal(chunkKey("https://app.example.com/main.js"), null);
  });
});

describe("cleanSourcePath", () => {
  it("strips bundler prefixes", () => {
    assert.equal(
      cleanSourcePath("turbopack:///[project]/src/app/page.tsx"),
      "src/app/page.tsx",
    );
    assert.equal(cleanSourcePath("webpack://_N_E/./src/a.ts"), "src/a.ts");
  });
});

describe("decodeStackWith", () => {
  it("maps Chrome and Safari frames and keeps unknown chunks raw", async () => {
    const stack = [
      "TypeError: boom",
      "    at e (https://app.example.com/_next/static/chunks/abc.js:1:1)",
      "u@https://app.example.com/_next/static/chunks/abc.js:2:5",
      "    at foo (https://app.example.com/_next/static/chunks/missing.js:3:4)",
    ].join("\n");

    const result = await decodeStackWith(stack, loader);

    assert.equal(result.mapped, 2);
    const lines = result.text.split("\n");
    assert.equal(lines[0], "TypeError: boom");
    assert.equal(lines[1], "    at handleSave (src/components/Foo.tsx:1:1)");
    assert.equal(lines[2], "    at u (src/components/Foo.tsx:2:1)");
    assert.equal(lines[3], stack.split("\n")[3]);

    assert.equal(result.frames[0].decoded, true);
    assert.match(result.frames[0].snippet ?? "", />\s+1 \| function handleSave/);
    assert.equal(result.frames[2].decoded, false);
  });

  it("returns the stack unchanged when no maps load", async () => {
    const stack = "Error: x\n    at https://app.example.com/_next/static/chunks/zzz.js:1:10";
    const result = await decodeStackWith(stack, async () => null);
    assert.equal(result.mapped, 0);
    assert.equal(result.text, stack);
  });
});
