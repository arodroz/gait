import { describe, it, expect } from "vitest";
import { getProfile, listProfiles } from "./profiles";

describe("getProfile", () => {
  it("returns quick profile", () => {
    const p = getProfile({}, "quick");
    expect(p.name).toBe("quick");
    expect(p.stages).toEqual([]);
  });

  it("returns default profile for unknown name", () => {
    const p = getProfile({}, "unknown");
    expect(p.name).toBe("default");
  });
});

describe("listProfiles", () => {
  it("includes quick and default", () => {
    expect(listProfiles({})).toContain("quick");
    expect(listProfiles({})).toContain("default");
  });
});
