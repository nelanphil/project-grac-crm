import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicAssetSlugFromPath } from "./publicImagePath.mjs";

describe("publicAssetSlugFromPath", () => {
  it("extracts a public image slug with or without a trailing slash", () => {
    assert.equal(publicAssetSlugFromPath("/images/mu2y7d4r-6xjl2f"), "mu2y7d4r-6xjl2f");
    assert.equal(publicAssetSlugFromPath("/images/mu2y7d4r-6xjl2f/"), "mu2y7d4r-6xjl2f");
    assert.equal(
      publicAssetSlugFromPath("/public-assets/msus7yfo-xm36lo"),
      "msus7yfo-xm36lo",
    );
  });

  it("does not treat static files under /images as slugs", () => {
    assert.equal(
      publicAssetSlugFromPath("/images/generac-product-lineup.jpg"),
      null,
    );
    assert.equal(publicAssetSlugFromPath("/images/"), null);
    assert.equal(publicAssetSlugFromPath("/dashboard/admin/"), null);
  });
});
