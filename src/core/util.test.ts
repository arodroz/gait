import { describe, it, expect } from "vitest";
import { parseDuration } from "./util";

describe("parseDuration", () => {
  it("parses seconds", () => expect(parseDuration("300s")).toBe(300_000));
  it("parses minutes", () => expect(parseDuration("5m")).toBe(300_000));
  it("parses milliseconds", () => expect(parseDuration("500ms")).toBe(500));
  it("parses hours", () => expect(parseDuration("1h")).toBe(3_600_000));
  it("defaults on invalid", () => expect(parseDuration("bogus")).toBe(300_000));
});
