import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseXaiModelList } from "./xaiModels";

describe("parseXaiModelList", () => {
  it("lists language models and their aliases, newest first", () => {
    const models = parseXaiModelList({
      models: [
        {
          id: "grok-3",
          created: 100,
          aliases: ["grok-3-latest"],
          output_modalities: ["text"],
        },
        {
          id: "grok-4",
          created: 200,
          aliases: [" grok-4 ", "grok-4"],
          output_modalities: ["text", "image"],
        },
      ],
    });
    assert.deepEqual(models, [
      { id: "grok-4", aliases: [] },
      { id: "grok-3", aliases: ["grok-3-latest"] },
    ]);
  });

  it("reads the /v1/models list and drops image-only models", () => {
    const models = parseXaiModelList({
      data: [
        { id: "grok-imagine-image", created: 300, output_modalities: ["image"], aliases: [] },
        { id: "grok-4.3", created: 250, aliases: ["latest"] },
      ],
    });
    assert.deepEqual(models, [{ id: "grok-4.3", aliases: ["latest"] }]);
  });

  it("returns nothing for an empty or unexpected body", () => {
    assert.deepEqual(parseXaiModelList(null), []);
    assert.deepEqual(parseXaiModelList({ models: [{ id: "  " }] }), []);
  });
});
