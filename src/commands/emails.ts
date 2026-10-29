import type { EmailStatus } from "@postilon/node";
import { int, page, pageHelp, pageOptions, str } from "../args.js";
import { UsageError, type Command, type Group } from "../context.js";
import { details, listTable, table, truncate, when } from "../format.js";

const list: Command = {
  summary: "List sent emails, newest first",
  options: {
    ...pageOptions,
    status: { type: "string" },
    search: { type: "string", short: "q" },
    source: { type: "string" },
    days: { type: "string" },
  },
  help: [
    ["--status <status>", "Only this status, such as bounced"],
    ["-q, --search <text>", "Search the subject, ID, sender and recipients"],
    ["--source <source>", "api or smtp"],
    ["--days <n>", "Only the last n days"],
    ...pageHelp,
  ],
  async run(ctx, { values }) {
    const source = str(values, "source");
    if (source !== undefined && source !== "api" && source !== "smtp") throw new UsageError("--source takes api or smtp.");
    const paging = page(values);
    const emails = await ctx.client().emails.list({
      ...paging,
      status: str(values, "status") as EmailStatus | undefined,
      q: str(values, "search"),
      source,
      days: int(values, "days"),
    });
    ctx.print(emails, () =>
      listTable(emails, paging.offset ?? 0, "emails", ["ID", "STATUS", "TO", "SUBJECT", "CREATED"], (e) => [
        e.id,
        e.status,
        truncate(e.to.join(", "), 32),
        truncate(e.subject ?? ""),
        when(e.created_at),
      ]),
    );
  },
};

const get: Command = {
  summary: "Show an email and its events",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const e = await ctx.client().emails.get(id!);
    ctx.print(e, () => {
      let text = details([
        ["ID", e.id],
        ["Status", e.status],
        ["Environment", e.environment],
        ["From", e.from],
        ["To", e.to.join(", ")],
        ["Cc", e.cc?.join(", ")],
        ["Bcc", e.bcc?.join(", ")],
        ["Reply-To", e.reply_to],
        ["Subject", e.subject],
        ["Template", e.template_id],
        ["Tags", e.tags?.map((t) => `${t.name}=${t.value}`).join(", ")],
        ["Credits", e.credits_used],
        ["Created", when(e.created_at)],
        ["Scheduled", when(e.scheduled_at)],
        ["Sent", when(e.sent_at)],
        ["Delivered", when(e.delivered_at)],
      ]);
      if (e.events?.length) {
        text += "\n\n" + table(["TIME", "EVENT", "RECIPIENT"], e.events.map((ev) => [when(ev.occurred_at), ev.event_type, ev.recipient]));
      }
      return text;
    });
  },
};

const cancel: Command = {
  summary: "Cancel a queued or scheduled email",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const e = await ctx.client().emails.cancel(id!);
    ctx.print(e, () => `Canceled ${e.id}.`);
  },
};

export const emails: Group = { summary: "List, show and cancel sent emails", commands: { list, get, cancel } };
