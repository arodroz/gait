import { describe, it, expect } from "vitest";
import { parse, format, bump, parseConventional, detectBump, generateChangelog } from "./semver";

describe("parse + format", () => {
  it("parses simple version", () => {
    const v = parse("1.2.3");
    expect(v).toEqual({ major: 1, minor: 2, patch: 3, pre: "" });
  });

  it("parses v-prefixed version", () => {
    expect(parse("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: "" });
  });

  it("parses pre-release", () => {
    const v = parse("2.0.0-beta");
    expect(v?.pre).toBe("beta");
  });

  it("returns null for invalid", () => {
    expect(parse("invalid")).toBeNull();
  });

  it("round-trips format", () => {
    expect(format({ major: 1, minor: 2, patch: 3, pre: "" })).toBe("1.2.3");
    expect(format({ major: 2, minor: 0, patch: 0, pre: "rc1" })).toBe("2.0.0-rc1");
  });
});

describe("bump", () => {
  const v = { major: 1, minor: 2, patch: 3, pre: "" };

  it("bumps patch", () => {
    expect(format(bump(v, "patch"))).toBe("1.2.4");
  });

  it("bumps minor and resets patch", () => {
    expect(format(bump(v, "minor"))).toBe("1.3.0");
  });

  it("bumps major and resets minor+patch", () => {
    expect(format(bump(v, "major"))).toBe("2.0.0");
  });
});

describe("parseConventional", () => {
  it("parses feat", () => {
    const cc = parseConventional("feat: add login");
    expect(cc?.type).toBe("feat");
    expect(cc?.subject).toBe("add login");
    expect(cc?.breaking).toBe(false);
  });

  it("parses scoped fix", () => {
    const cc = parseConventional("fix(auth): handle nil token");
    expect(cc?.type).toBe("fix");
    expect(cc?.scope).toBe("auth");
  });

  it("parses breaking change", () => {
    const cc = parseConventional("feat!: remove deprecated API");
    expect(cc?.breaking).toBe(true);
  });

  it("returns null for non-conventional", () => {
    expect(parseConventional("just a message")).toBeNull();
  });
});

describe("detectBump", () => {
  it("detects patch from fix", () => {
    expect(detectBump(["fix: typo"])).toBe("patch");
  });

  it("detects minor from feat", () => {
    expect(detectBump(["feat: new feature"])).toBe("minor");
  });

  it("detects major from breaking", () => {
    expect(detectBump(["feat!: breaking change"])).toBe("major");
  });

  it("picks highest bump", () => {
    expect(detectBump(["fix: a", "feat: b"])).toBe("minor");
  });

  it("returns none for non-conventional", () => {
    expect(detectBump(["random message"])).toBe("none");
  });
});

describe("generateChangelog", () => {
  it("groups commits by type", () => {
    const cl = generateChangelog("v1.0.0", [
      "feat: add auth",
      "fix(api): handle null",
      "docs: update README",
    ]);
    expect(cl).toContain("v1.0.0");
    expect(cl).toContain("Features");
    expect(cl).toContain("Bug Fixes");
    expect(cl).toContain("add auth");
    expect(cl).toContain("**api**");
  });
});
