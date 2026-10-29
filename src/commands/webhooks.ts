import type { UpdateWebhookParams, Webhook, WebhookEventType } from "@postilon/node";
import { list as listOf, page, pageHelp, pageOptions, str } from "../args.js";
import { UsageError, type Command, type Group } from "../context.js";
import { details, listTable, truncate, when } from "../format.js";

function webhookDetails(w: Webhook): string {
  return details([
    ["ID", w.id],
    ["URL", w.url],
    ["Description", w.description],
    ["Events", w.subscribed_events.join(", ")],
    ["Active", w.is_active ? "yes" : "no"],
    ["Signing secret", w.signing_secret],
    ["Created", when(w.created_at)],
  ]);
}

const list: Command = {
  summary: "List webhook endpoints",
  options: pageOptions,
  help: pageHelp,
  async run(ctx, { values }) {
    const paging = page(values);
    const webhooks = await ctx.client().webhooks.list(paging);
    ctx.print(webhooks, () =>
      listTable(webhooks, paging.offset ?? 0, "webhooks", ["ID", "URL", "EVENTS", "ACTIVE"], (w) => [
        w.id,
        truncate(w.url),
        String(w.subscribed_events.length),
        w.is_active ? "yes" : "no",
      ]),
    );
  },
};

const get: Command = {
  summary: "Show a webhook endpoint",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const w = await ctx.client().webhooks.get(id!);
    ctx.print(w, () => webhookDetails(w));
  },
};

const add: Command = {
  summary: "Add a webhook endpoint",
  args: ["<url>"],
  options: { events: { type: "string", multiple: true }, description: { type: "string" } },
  help: [
    ["--events <type>", "Event to send, such as email.bounced; repeat or separate with commas (default: all)"],
    ["--description <text>", "A note for yourself"],
  ],
  notes: "See the event types with: postilon webhooks events",
  async run(ctx, { values, positionals: [url] }) {
    const events = listOf(values, "events") as WebhookEventType[] | undefined;
    const description = str(values, "description");
    const w = await ctx.client().webhooks.create({
      url: url!,
      ...(description !== undefined && { description }),
      ...(events && { subscribed_events: events }),
    });
    ctx.print(w, () => `${webhookDetails(w)}\n\nVerify deliveries with the signing secret: https://postilon.com/docs/webhooks`);
  },
};

const update: Command = {
  summary: "Change a webhook endpoint",
  args: ["<id>"],
  options: {
    url: { type: "string" },
    description: { type: "string" },
    events: { type: "string", multiple: true },
    enable: { type: "boolean" },
    disable: { type: "boolean" },
  },
  help: [
    ["--url <url>", "New URL"],
    ["--description <text>", "New description"],
    ["--events <type>", "Replace the events; repeat or separate with commas"],
    ["--enable, --disable", "Turn deliveries on or off"],
  ],
  async run(ctx, { values, positionals: [id] }) {
    if (values.enable && values.disable) throw new UsageError("Use --enable or --disable, not both.");
    const params: UpdateWebhookParams = {};
    const url = str(values, "url");
    const description = str(values, "description");
    const events = listOf(values, "events") as WebhookEventType[] | undefined;
    if (url !== undefined) params.url = url;
    if (description !== undefined) params.description = description;
    if (events) params.subscribed_events = events;
    if (values.enable) params.is_active = true;
    if (values.disable) params.is_active = false;
    if (Object.keys(params).length === 0) throw new UsageError("Pass --url, --description, --events, --enable or --disable.");
    const w = await ctx.client().webhooks.update(id!, params);
    ctx.print(w, () => webhookDetails(w));
  },
};

const remove: Command = {
  summary: "Remove a webhook endpoint",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const res = await ctx.client().webhooks.delete(id!);
    ctx.print(res, () => `Removed ${id}.`);
  },
};

const test: Command = {
  summary: "Send a webhook.test event to an endpoint",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const d = await ctx.client().webhooks.test(id!);
    ctx.print(d, () => `Sent webhook.test as ${d.id}: ${d.status}${d.response_status ? ` (HTTP ${d.response_status})` : ""}.`);
  },
};

const events: Command = {
  summary: "List the event types an endpoint can receive",
  async run(ctx) {
    const res = await ctx.client().webhooks.listEventTypes();
    ctx.print(res, () => res.data.join("\n"));
  },
};

const deliveries: Command = {
  summary: "List recent deliveries",
  options: { ...pageOptions, webhook: { type: "string" } },
  help: [["--webhook <id>", "Only this endpoint's deliveries"], ...pageHelp],
  async run(ctx, { values }) {
    const paging = page(values);
    const list = await ctx.client().webhooks.listDeliveries({ ...paging, webhook_id: str(values, "webhook") });
    ctx.print(list, () =>
      listTable(list, paging.offset ?? 0, "deliveries", ["ID", "EVENT", "STATUS", "HTTP", "ATTEMPTS", "CREATED"], (d) => [
        d.id,
        d.event_type,
        d.status,
        d.response_status ? String(d.response_status) : "-",
        String(d.attempt_count),
        when(d.created_at),
      ]),
    );
  },
};

const replay: Command = {
  summary: "Send a delivery again",
  args: ["<delivery-id>"],
  async run(ctx, { positionals: [id] }) {
    const d = await ctx.client().webhooks.replayDelivery(id!);
    ctx.print(d, () => `Replayed as ${d.id}: ${d.status}${d.response_status ? ` (HTTP ${d.response_status})` : ""}.`);
  },
};

export const webhooks: Group = {
  summary: "Manage webhook endpoints and deliveries",
  commands: { list, get, add, update, remove, test, events, deliveries, replay },
};
