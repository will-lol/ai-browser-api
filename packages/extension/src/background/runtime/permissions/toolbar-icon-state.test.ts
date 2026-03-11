import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isToolbarIconActive,
  tabUrlOrigin,
} from "@/background/runtime/permissions/toolbar-icon-state";

describe("tabUrlOrigin", () => {
  it("returns null when url is missing", () => {
    assert.equal(tabUrlOrigin(undefined), null);
  });

  it("returns null for non-http urls", () => {
    assert.equal(tabUrlOrigin("chrome://extensions"), null);
    assert.equal(tabUrlOrigin("about:blank"), null);
  });

  it("returns origin for http/https urls", () => {
    assert.equal(
      tabUrlOrigin("https://example.com/path?q=1"),
      "https://example.com",
    );
  });
});

describe("isToolbarIconActive", () => {
  it("is inactive when there is no active tab origin", () => {
    assert.equal(
      isToolbarIconActive({
        activeOrigin: null,
        originEnabled: true,
        allowedModelIds: ["google/gemini-2.5-pro"],
        connectedModelIds: new Set(["google/gemini-2.5-pro"]),
      }),
      false,
    );
  });

  it("is inactive when the origin is disabled", () => {
    assert.equal(
      isToolbarIconActive({
        activeOrigin: "https://example.com",
        originEnabled: false,
        allowedModelIds: ["google/gemini-2.5-pro"],
        connectedModelIds: new Set(["google/gemini-2.5-pro"]),
      }),
      false,
    );
  });

  it("is inactive when origin is enabled but there are no allowed permissions", () => {
    assert.equal(
      isToolbarIconActive({
        activeOrigin: "https://example.com",
        originEnabled: true,
        allowedModelIds: [],
        connectedModelIds: new Set(["google/gemini-2.5-pro"]),
      }),
      false,
    );
  });

  it("is inactive when permission is allowed but backing provider model is disconnected", () => {
    assert.equal(
      isToolbarIconActive({
        activeOrigin: "https://example.com",
        originEnabled: true,
        allowedModelIds: ["google/gemini-2.5-pro"],
        connectedModelIds: new Set(),
      }),
      false,
    );
  });

  it("is active when origin is enabled with a connected allowed model", () => {
    assert.equal(
      isToolbarIconActive({
        activeOrigin: "https://example.com",
        originEnabled: true,
        allowedModelIds: ["google/gemini-2.5-pro"],
        connectedModelIds: new Set(["google/gemini-2.5-pro"]),
      }),
      true,
    );
  });

  it("is active when multiple permissions exist and one model is connected", () => {
    assert.equal(
      isToolbarIconActive({
        activeOrigin: "https://example.com",
        originEnabled: true,
        allowedModelIds: ["google/gemini-2.5-pro", "openai/gpt-4.1"],
        connectedModelIds: new Set(["openai/gpt-4.1"]),
      }),
      true,
    );
  });
});
