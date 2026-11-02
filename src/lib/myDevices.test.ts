// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogCategories,
  devicesByType,
  isUuid,
  osRange,
  parseDeviceId,
  parseNickname,
  type CatalogDevice,
} from "./myDevices.ts";

describe("input validation", () => {
  it("accepts only positive whole device ids", () => {
    assert.equal(parseDeviceId(12), 12);
    assert.equal(parseDeviceId("12"), 12);
    for (const bad of [0, -1, 1.5, "1.5", "abc", "", null, undefined, NaN, {}, [], "12; drop table", 2 ** 60]) {
      assert.equal(parseDeviceId(bad), null, String(bad));
    }
  });

  it("trims and limits nicknames", () => {
    assert.equal(parseNickname("  Dad's   iPad "), "Dad's iPad");
    assert.equal(parseNickname(""), null);
    assert.equal(parseNickname("   "), null);
    assert.equal(parseNickname(undefined), null);
    assert.equal(parseNickname(null), null);
    assert.equal(parseNickname("x".repeat(60)), "x".repeat(60));
    assert.equal(parseNickname("x".repeat(61)), undefined);
    assert.equal(parseNickname(42), undefined);
    assert.equal(parseNickname("bad\u0007bell"), undefined);
    assert.equal(parseNickname("Emoji 📱 ok"), "Emoji 📱 ok");
  });

  it("recognises UUIDs", () => {
    assert.equal(isUuid("3f2b8a52-1c4e-4b7a-9d3e-0a1b2c3d4e5f"), true);
    assert.equal(isUuid("3f2b8a52-1c4e-4b7a-9d3e"), false);
    assert.equal(isUuid("' or 1=1 --"), false);
    assert.equal(isUuid(7), false);
  });
});

describe("display helpers", () => {
  it("describes the oldest and newest OS", () => {
    const d = { min_os_family: "iOS", min_os_version: "10.3", max_os_family: "iPadOS", max_os_version: "16.7.16" };
    assert.deepEqual(osRange(d), { oldest: "iOS 10.3", newest: "iPadOS 16.7.16" });
    assert.equal(osRange({ ...d, max_os_family: "HomePod Software", max_os_version: "27.2" }).newest, "HomePod 27.2");
    assert.equal(osRange({ ...d, max_os_version: null }).newest, "unknown");
  });
});

describe("device dropdown", () => {
  const dev = (id: number, name: string, category: string, device_type: string | null, released: string | null): CatalogDevice =>
    ({ id, name, category, device_type, released });
  const catalog = [
    dev(1, "iPhone 8", "iPhone", "iPhone", "2017-09-22"),
    dev(2, "iPhone 16 Pro", "iPhone", "iPhone", "2024-09-20"),
    dev(3, "iPhone 11", "iPhone", "iPhone", "2019-09-20"),
    dev(4, "iPhone 7", "iPhone", "iPhone", null),
    dev(5, "iMac (24-inch, M4, 2024)", "Mac", "iMac", "2024-11-08"),
    dev(6, "MacBook Air (M2, 2022)", "Mac", "MacBook Air", "2022-07-15"),
    dev(7, "MacBook Air (M4, 2025)", "Mac", "MacBook Air", "2025-03-12"),
    dev(8, "PowerBook G4", "Mac", "PowerBook", "2001-01-01"),
    dev(9, "Mystery Mac", "Mac", "Zeta", "2023-01-01"),
    dev(10, "iPad Pro 13-inch (M4)", "iPad", "iPad Pro", "2024-05-15"),
    dev(11, "iPad (10th generation)", "iPad", "iPad", "2022-10-26"),
    dev(12, "Some Case", "Zeta", null, null),
  ];

  it("lists categories in a sensible order with counts", () => {
    assert.deepEqual(catalogCategories(catalog), [
      { category: "iPhone", count: 4 },
      { category: "iPad", count: 2 },
      { category: "Mac", count: 5 },
      { category: "Zeta", count: 1 },
    ]);
  });

  it("lists a single-type category newest first, with undated devices last", () => {
    const groups = devicesByType(catalog, "iPhone");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, null);
    assert.deepEqual(groups[0].devices.map((d) => d.name), ["iPhone 16 Pro", "iPhone 11", "iPhone 8", "iPhone 7"]);
  });

  it("sub-groups a mixed category by product type, newest first, unknown types last", () => {
    const groups = devicesByType(catalog, "Mac");
    assert.deepEqual(groups.map((g) => g.label), ["MacBook Air", "iMac", "PowerBook", "Zeta"]);
    assert.deepEqual(groups[0].devices.map((d) => d.name), ["MacBook Air (M4, 2025)", "MacBook Air (M2, 2022)"]);
    assert.deepEqual(devicesByType(catalog, "iPad").map((g) => g.label), ["iPad Pro", "iPad"]);
  });

  it("returns nothing for an unknown category", () => {
    assert.deepEqual(devicesByType(catalog, "Toaster"), []);
  });
});
