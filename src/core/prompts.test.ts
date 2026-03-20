import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseTemplate, listTemplates, interpolate, createDefaults } from "./prompts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-prompts-"));
}

describe("parseTemplate", () => {
  it("parses frontmatter and body", () => {
    const dir = tmpDir();
    const p = path.join(dir, "fix.md");
    fs.writeFileSync(p, `---
name: fix-lint
description: Fix lint errors
variables: [error, file]
---
Fix {{error}} in {{file}}.`);

    const tmpl = parseTemplate(p);
    expect(tmpl.name).toBe("fix-lint");
    expect(tmpl.description).toBe("Fix lint errors");
    expect(tmpl.variables).toEqual(["error", "file"]);
    expect(tmpl.body).toContain("{{error}}");
  });
});

describe("interpolate", () => {
  it("replaces variables", () => {
    expect(interpolate("Fix {{error}} in {{file}}", { error: "TS2345", file: "config.ts" }))
      .toBe("Fix TS2345 in config.ts");
  });

  it("handles missing variables", () => {
    expect(interpolate("{{missing}}", {})).toBe("{{missing}}");
  });
});

describe("createDefaults", () => {
  it("creates default templates", () => {
    const dir = tmpDir();
    createDefaults(dir);
    const files = fs.readdirSync(path.join(dir, "prompts"));
    expect(files).toContain("fix-lint.md");
    expect(files).toContain("fix-test.md");
    expect(files).toContain("add-tests.md");
    expect(files).toContain("refactor.md");
  });
});

describe("listTemplates", () => {
  it("lists templates", () => {
    const dir = tmpDir();
    createDefaults(dir);
    const templates = listTemplates(dir);
    expect(templates.length).toBe(4);
  });
});
