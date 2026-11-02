// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashForTab, nextTabForKey, tabFromHash } from "./tabs.ts";

describe("tabs", () => {
  it("moves with the arrow keys and wraps around", () => {
    assert.equal(nextTabForKey("ArrowRight", "versions"), "devices");
    assert.equal(nextTabForKey("ArrowRight", "devices"), "versions");
    assert.equal(nextTabForKey("ArrowLeft", "versions"), "devices");
    assert.equal(nextTabForKey("ArrowLeft", "devices"), "versions");
  });

  it("jumps to the ends with Home and End, and ignores other keys", () => {
    assert.equal(nextTabForKey("Home", "devices"), "versions");
    assert.equal(nextTabForKey("End", "versions"), "devices");
    for (const key of ["Enter", " ", "a", "Tab", "Escape"]) assert.equal(nextTabForKey(key, "versions"), null, key);
  });

  it("opens My devices from its link and leaves the default address plain", () => {
    assert.equal(tabFromHash("#my-devices"), "devices");
    assert.equal(tabFromHash("#results"), null);
    assert.equal(tabFromHash(""), null);
    assert.equal(hashForTab("devices"), "#my-devices");
    assert.equal(hashForTab("versions"), "");
  });
});
