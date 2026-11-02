// Run with: npm test
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { TOUR_STEPS, tourSteps } from "./tourSteps.ts";

describe("tour steps", () => {
  it("shows signed-out visitors nine steps and signed-in visitors ten", () => {
    assert.equal(tourSteps(false).length, 9);
    assert.equal(tourSteps(true).length, 10);
  });

  it("keeps the order: controls first, then the content you can click into, then the finish", () => {
    assert.deepEqual(
      tourSteps(true).map((s) => s.id),
      ["welcome", "tabs", "settings", "theme", "size", "options", "refresh", "supported-devices", "save-devices", "done"],
    );
    assert.ok(!tourSteps(false).some((s) => s.id === "save-devices"));
  });

  it("runs each step on the tab where its target lives", () => {
    const byId = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s]));
    assert.equal(byId["supported-devices"].tab, "versions");
    assert.equal(byId["save-devices"].tab, "devices");
    assert.equal(byId["tabs"].tab, undefined); // the tab bar itself is always visible
  });

  it("only offers a Show me demo that exists, and one per step", () => {
    const demos = new Set(["theme", "size", "options", "refresh", "devices"]);
    for (const s of TOUR_STEPS) if (s.demo) assert.ok(demos.has(s.demo), s.id);
    assert.equal(new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length); // unique ids
  });

  it("points only at elements that exist in the page's source", () => {
    const dir = new URL("../components/", import.meta.url);
    const source = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => readFileSync(new URL(f, dir), "utf8"))
      .join("\n");
    for (const s of TOUR_STEPS) {
      if (s.target) assert.ok(source.includes(`"${s.target}"`) || source.includes(`id="${s.target}"`), `${s.id}: ${s.target}`);
    }
  });
});
