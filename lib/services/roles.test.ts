import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "../rbac/permissions";
import { diffPermissions, expandPermissions, grantsUserAdmin, permissionCatalog, validatePermissions, wouldRemoveLastAdmin } from "./roles";

describe("permission catalog", () => {
  it("covers every permission exactly once, grouped by area", () => {
    const keys = permissionCatalog().flatMap((a) => a.permissions.map((p) => p.key));
    expect(keys.length).toBe(ALL_PERMISSIONS.length);
    expect(new Set(keys).size).toBe(ALL_PERMISSIONS.length);
    for (const area of permissionCatalog()) for (const p of area.permissions) expect(p.key.startsWith(area.area + ".")).toBe(true);
  });
});

describe("expandPermissions", () => {
  it("expands * to everything", () => {
    expect(expandPermissions(["*"])).toEqual(ALL_PERMISSIONS);
  });
  it("expands resource wildcards and drops unknown keys", () => {
    const out = expandPermissions(["devices.*", "alerts.view", "bogus.thing"]);
    expect(out).toContain("devices.view");
    expect(out).toContain("devices.delete");
    expect(out).toContain("alerts.view");
    expect(out).not.toContain("bogus.thing");
    expect(out).not.toContain("alerts.manage");
  });
  it("deduplicates and keeps the canonical order", () => {
    expect(expandPermissions(["alerts.view", "devices.view", "alerts.view"])).toEqual(["devices.view", "alerts.view"]);
  });
});

describe("validatePermissions", () => {
  it("accepts a subset of known keys", () => {
    const v = validatePermissions(["devices.view", "alerts.view"]);
    expect(v.ok).toBe(true);
    expect(v.permissions).toEqual(["devices.view", "alerts.view"]);
  });
  it("rejects wildcards and typos for custom roles", () => {
    const v = validatePermissions(["devices.*", "devices.veiw", "*"]);
    expect(v.ok).toBe(false);
    expect(v.unknown).toEqual(["devices.*", "devices.veiw", "*"]);
  });
});

describe("last-admin maths", () => {
  it("recognises administrators through wildcards", () => {
    expect(grantsUserAdmin(["*"])).toBe(true);
    expect(grantsUserAdmin(["users.*"])).toBe(true);
    expect(grantsUserAdmin(["users.manage"])).toBe(true);
    expect(grantsUserAdmin(["users.view", "devices.view"])).toBe(false);
  });
  it("refuses to demote the only administrator", () => {
    expect(wouldRemoveLastAdmin(["u1"], "u1", false)).toBe(true);
    expect(wouldRemoveLastAdmin(["u1", "u2"], "u1", false)).toBe(false);
    expect(wouldRemoveLastAdmin(["u1"], "u1", true)).toBe(false);
    expect(wouldRemoveLastAdmin(["u1"], "u9", false)).toBe(false);
  });
});

describe("diffPermissions", () => {
  it("reports added and removed concrete permissions", () => {
    const d = diffPermissions(["devices.view"], ["devices.view", "alerts.view"]);
    expect(d).toEqual({ added: ["alerts.view"], removed: [] });
    expect(diffPermissions(["*"], ["devices.view"]).removed.length).toBe(ALL_PERMISSIONS.length - 1);
  });
});
