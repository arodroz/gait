import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration, timestamp } from "./util";

describe("parseDuration", () => {
  it("parses seconds", () => expect(parseDuration("300s")).toBe(300_000));
  it("parses minutes", () => expect(parseDuration("5m")).toBe(300_000));
  it("parses milliseconds", () => expect(parseDuration("500ms")).toBe(500));
  it("parses hours", () => expect(parseDuration("1h")).toBe(3_600_000));
  it("defaults on invalid", () => expect(parseDuration("bogus")).toBe(300_000));
});

describe("formatDuration", () => {
  it("formats ms", () => expect(formatDuration(42)).toBe("42ms"));
  it("formats seconds", () => expect(formatDuration(1500)).toBe("1.5s"));
  it("formats minutes", () => expect(formatDuration(65_000)).toBe("1m5s"));
});

describe("timestamp", () => {
  it("returns HH:MM:SS format", () => {
    const ts = timestamp();
    expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
