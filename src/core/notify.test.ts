import { describe, it } from "vitest";
import { notify, type NotifyConfig, type NotifyPayload } from "./notify";

describe("notify", () => {
  it("skips when event is not in configured events", async () => {
    const cfg: NotifyConfig = {
      generic_webhook: "http://localhost:9999/hook",
      events: ["gate.failed"],
    };
    const payload: NotifyPayload = {
      event: "gate.passed",
      project: "test",
      branch: "main",
      message: "test passed",
    };
    // Should not throw — just skips
    await notify(cfg, payload);
  });

  it("skips when no webhooks configured", async () => {
    const cfg: NotifyConfig = {};
    const payload: NotifyPayload = {
      event: "gate.passed",
      project: "test",
      branch: "main",
      message: "test",
    };
    await notify(cfg, payload);
  });

  it("handles empty events list (sends to all)", async () => {
    // No events filter = send everything
    const cfg: NotifyConfig = { events: [] };
    const payload: NotifyPayload = {
      event: "regression.detected",
      project: "test",
      branch: "main",
      message: "regression",
    };
    // Should not throw even with no webhooks
    await notify(cfg, payload);
  });
});
