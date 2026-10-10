import { describe, expect, it } from "vitest";
import { compareVersions, isOutdated, newestVersion } from "./agent-version";

describe("compareVersions", () => {
  it("orders numeric segments numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("2", "1.99.99")).toBeGreaterThan(0);
  });
  it("treats missing segments as zero and ignores a leading v", () => {
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(compareVersions("v1.4.0", "1.4.0")).toBe(0);
  });
  it("sorts pre-releases below the release of the same numbers", () => {
    expect(compareVersions("0.1.0-dev", "0.1.0")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.0-rc1")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0-alpha", "0.1.0-beta")).toBeLessThan(0);
    expect(compareVersions("0.2.0-dev", "0.1.0")).toBeGreaterThan(0);
  });
});

describe("newestVersion / isOutdated", () => {
  it("finds the newest version and flags everything older", () => {
    const newest = newestVersion(["0.1.0-dev", "1.2.0", null, "1.10.1", undefined, "1.3.0"]);
    expect(newest).toBe("1.10.1");
    expect(isOutdated("1.2.0", newest)).toBe(true);
    expect(isOutdated("1.10.1", newest)).toBe(false);
    expect(isOutdated("2.0.0", newest)).toBe(false);
  });
  it("never flags devices without a reported version", () => {
    expect(newestVersion([])).toBeNull();
    expect(isOutdated(null, "1.0.0")).toBe(false);
    expect(isOutdated("0.9.0", null)).toBe(false);
  });
});
