import * as https from "https";
import * as http from "http";
import * as url from "url";

export type NotifyEvent = "gate.passed" | "gate.failed" | "agent.done" | "release.tagged" | "regression.detected";

export interface NotifyConfig {
  slack_webhook?: string;
  discord_webhook?: string;
  generic_webhook?: string;
  events?: NotifyEvent[];
}

export interface NotifyPayload {
  event: NotifyEvent;
  project: string;
  branch: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Send notification if the event is configured */
export async function notify(cfg: NotifyConfig, payload: NotifyPayload): Promise<void> {
  const events = cfg.events ?? [];
  if (events.length > 0 && !events.includes(payload.event)) return;

  const promises: Promise<void>[] = [];

  if (cfg.slack_webhook) {
    promises.push(sendSlack(cfg.slack_webhook, payload));
  }
  if (cfg.discord_webhook) {
    promises.push(sendDiscord(cfg.discord_webhook, payload));
  }
  if (cfg.generic_webhook) {
    promises.push(sendGeneric(cfg.generic_webhook, payload));
  }

  await Promise.allSettled(promises);
}

async function sendSlack(webhook: string, payload: NotifyPayload): Promise<void> {
  const emoji = payload.event.includes("passed") || payload.event === "release.tagged"
    ? "\u2705" : payload.event.includes("failed") || payload.event === "regression.detected"
      ? "\u274C" : "\u2139\uFE0F";

  const body = {
    text: `${emoji} *[${payload.project}]* ${payload.message}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${payload.message}*\n_${payload.project}_ on \`${payload.branch}\``,
        },
      },
    ],
  };

  if (payload.details) {
    const fields = Object.entries(payload.details)
      .slice(0, 5)
      .map(([k, v]) => `*${k}*: ${v}`)
      .join("\n");
    body.blocks.push({ type: "section", text: { type: "mrkdwn", text: fields } });
  }

  await postJson(webhook, body);
}

async function sendDiscord(webhook: string, payload: NotifyPayload): Promise<void> {
  const color = payload.event.includes("passed") || payload.event === "release.tagged"
    ? 0x3fb950 : payload.event.includes("failed") || payload.event === "regression.detected"
      ? 0xf85149 : 0x58a6ff;

  const body = {
    embeds: [{
      title: payload.message,
      description: `${payload.project} on \`${payload.branch}\``,
      color,
      fields: payload.details
        ? Object.entries(payload.details).slice(0, 5).map(([k, v]) => ({ name: k, value: String(v), inline: true }))
        : [],
    }],
  };

  await postJson(webhook, body);
}

async function sendGeneric(webhook: string, payload: NotifyPayload): Promise<void> {
  await postJson(webhook, payload);
}

function postJson(webhookUrl: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(webhookUrl);
    const data = JSON.stringify(body);
    const mod = parsed.protocol === "https:" ? https : http;

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      res.resume();
      resolve();
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(data);
    req.end();
  });
}
