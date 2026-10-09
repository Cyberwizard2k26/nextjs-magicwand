import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/devices?status=online")).toBe("/devices?status=online");
  });
  it("rejects absolute and protocol-relative URLs", () => {
    for (const v of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined]) expect(safeNext(v)).toBe("/");
  });
});
