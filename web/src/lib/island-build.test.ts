import { describe, expect, it } from "vitest";

import { islandUpdateTag, RECOMMENDED_ISLAND_BUILD } from "./island-build";

const recommended = { build: 2, tag: "v1.18.101" };

describe("islandUpdateTag", () => {
  it("does not offer an app update in a browser or PWA", () => {
    expect(islandUpdateTag(undefined, recommended)).toBeNull();
  });
  it("treats a shell without build metadata as build 1", () => {
    expect(islandUpdateTag({}, recommended)).toBe("v1.18.101");
  });
  it("offers an update to an older shell", () => {
    expect(islandUpdateTag({ build: 1 }, recommended)).toBe("v1.18.101");
  });
  it("does not offer an update to an equal or newer shell", () => {
    expect(islandUpdateTag({ build: 2 }, recommended)).toBeNull();
    expect(islandUpdateTag({ build: 3 }, recommended)).toBeNull();
  });
  it("does not offer an update before the IPA is published", () => {
    expect(islandUpdateTag({ build: 1 }, { build: 2, tag: null })).toBeNull();
  });
  it("sends shells older than build 4 to the published v2.1.0 IPA", () => {
    expect(islandUpdateTag({ build: 3 }, RECOMMENDED_ISLAND_BUILD)).toBe("v2.1.0");
    expect(islandUpdateTag({ build: 4 }, RECOMMENDED_ISLAND_BUILD)).toBeNull();
  });
});
