import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detect, affected, scopedTestCommand, scopedLintCommand, type Workspace } from "./monorepo";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-mono-"));
}

describe("detect", () => {
  it("detects go workspaces from go.work", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "go.work"), "go 1.21\n\nuse (\n\t./api\n\t./worker\n)\n");
    fs.mkdirSync(path.join(dir, "api"));
    fs.mkdirSync(path.join(dir, "worker"));

    const ws = detect(dir);
    const goWs = ws.filter((w) => w.kind === "go");
    expect(goWs.length).toBe(2);
    expect(goWs.map((w) => w.name)).toContain("api");
    expect(goWs.map((w) => w.name)).toContain("worker");
  });

  it("detects npm workspaces from package.json", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "packages", "core"), { recursive: true });
    fs.mkdirSync(path.join(dir, "packages", "cli"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));

    const ws = detect(dir);
    const npmWs = ws.filter((w) => w.kind === "npm");
    expect(npmWs.length).toBe(2);
  });

  it("detects python workspaces from pyproject.toml", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "svc-auth"));
    fs.writeFileSync(path.join(dir, "svc-auth", "pyproject.toml"), "");

    const ws = detect(dir);
    expect(ws.some((w) => w.kind === "python" && w.name === "svc-auth")).toBe(true);
  });

  it("returns empty for non-monorepo", () => {
    expect(detect(tmpDir())).toEqual([]);
  });
});

describe("affected", () => {
  const workspaces: Workspace[] = [
    { name: "api", path: "api", kind: "go" },
    { name: "worker", path: "worker", kind: "go" },
    { name: "frontend", path: "frontend", kind: "npm" },
  ];

  it("finds affected workspaces from changed files", () => {
    const result = affected(workspaces, ["api/handler.go", "api/routes.go"]);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("api");
  });

  it("finds multiple affected", () => {
    const result = affected(workspaces, ["worker/main.go", "frontend/src/app.tsx"]);
    expect(result.length).toBe(2);
  });

  it("returns empty for unrelated changes", () => {
    expect(affected(workspaces, ["README.md"])).toEqual([]);
  });
});

describe("scopedTestCommand", () => {
  it("scopes go test to workspace path", () => {
    const ws: Workspace = { name: "api", path: "api", kind: "go" };
    expect(scopedTestCommand(ws, "go test ./...")).toBe("go test ./api/...");
  });

  it("scopes npm test to workspace", () => {
    const ws: Workspace = { name: "frontend", path: "packages/frontend", kind: "npm" };
    expect(scopedTestCommand(ws, "npm test")).toBe("npm run test --workspace=packages/frontend");
  });

  it("scopes pytest to workspace dir", () => {
    const ws: Workspace = { name: "svc", path: "svc", kind: "python" };
    expect(scopedTestCommand(ws, "pytest")).toBe("pytest svc");
  });
});

describe("scopedLintCommand", () => {
  it("scopes go vet to workspace", () => {
    const ws: Workspace = { name: "api", path: "api", kind: "go" };
    expect(scopedLintCommand(ws, "go vet ./...")).toBe("go vet ./api/...");
  });

  it("scopes eslint to workspace dir", () => {
    const ws: Workspace = { name: "web", path: "packages/web", kind: "npm" };
    expect(scopedLintCommand(ws, "npx eslint .")).toBe("npx eslint packages/web/");
  });

  it("scopes ruff to workspace", () => {
    const ws: Workspace = { name: "svc", path: "svc", kind: "python" };
    expect(scopedLintCommand(ws, "ruff check .")).toBe("ruff check svc");
  });
});
