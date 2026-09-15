import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { getPublicAssetBySlug } from "../controllers/publicAsset.controller";
import { PublicAsset } from "../models/mongo/PublicAsset";
import {
  fetchPublicAssetMedia,
  isAllowedPublicAssetUrl,
  PublicAssetProxyError,
} from "./publicAssetProxy";

describe("isAllowedPublicAssetUrl", () => {
  it("allows Cloudinary HTTPS hosts", () => {
    assert.equal(
      isAllowedPublicAssetUrl(
        "https://res.cloudinary.com/dtxc1dbfx/image/upload/v1/public/foo.jpg",
      ),
      true,
    );
    assert.equal(
      isAllowedPublicAssetUrl("https://media.cloudinary.com/image.jpg"),
      true,
    );
  });

  it("rejects non-Cloudinary, non-HTTPS, and invalid URLs", () => {
    assert.equal(isAllowedPublicAssetUrl("https://example.com/x.jpg"), false);
    assert.equal(
      isAllowedPublicAssetUrl("http://res.cloudinary.com/dtxc1dbfx/x.jpg"),
      false,
    );
    assert.equal(
      isAllowedPublicAssetUrl("https://res.cloudinary.com.evil.com/x.jpg"),
      false,
    );
    assert.equal(isAllowedPublicAssetUrl("not-a-url"), false);
  });
});

describe("fetchPublicAssetMedia", () => {
  it("streams Cloudinary bytes", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(Buffer.from("fakejpeg"), {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": "8",
        },
      })) as typeof fetch;

    try {
      const result = await fetchPublicAssetMedia(
        "https://res.cloudinary.com/dtxc1dbfx/image/upload/v1/public/foo.jpg",
      );
      assert.equal(result.contentType, "image/jpeg");
      assert.equal(result.contentLength, "8");
      const bytes = Buffer.from(await new Response(result.body).arrayBuffer());
      assert.equal(bytes.toString(), "fakejpeg");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses to proxy a non-Cloudinary URL", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope");
    }) as typeof fetch;

    try {
      await assert.rejects(
        () => fetchPublicAssetMedia("https://example.com/secret.jpg"),
        (err: unknown) =>
          err instanceof PublicAssetProxyError && err.status === 502,
      );
      assert.equal(called, false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses a Cloudinary URL that redirects off the allowlist", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      const response = new Response(Buffer.from("stolen"), { status: 200 });
      Object.defineProperty(response, "url", {
        value: "https://example.com/stolen.jpg",
      });
      return response;
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          fetchPublicAssetMedia(
            "https://res.cloudinary.com/dtxc1dbfx/image/upload/v1/public/foo.jpg",
          ),
        (err: unknown) =>
          err instanceof PublicAssetProxyError && err.status === 502,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("getPublicAssetBySlug", () => {
  it("returns 404 when the asset is missing or inactive", async () => {
    const findOne = mock.method(PublicAsset, "findOne", () => ({
      lean: async () => null,
    }));

    try {
      const req = { params: { slug: "msus7yfo-xm36lo" } } as never;
      let statusCode = 0;
      let body: unknown;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
        setHeader() {
          return this;
        },
      };

      await getPublicAssetBySlug(req, res as never);
      assert.equal(statusCode, 404);
      assert.deepEqual(body, {
        message: "Public asset not found or inactive.",
      });
      const filter = findOne.mock.calls[0]?.arguments[0] as
        | { isActive?: boolean }
        | undefined;
      assert.equal(filter?.isActive, true);
    } finally {
      findOne.mock.restore();
    }
  });
});
