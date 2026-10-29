import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { SendEmailParams } from "@postilon/node";
import { content, list, pairs, str } from "../args.js";
import { UsageError, type Command } from "../context.js";
import { when } from "../format.js";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".ics": "text/calendar",
  ".json": "application/json",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const send: Command = {
  summary: "Send an email",
  options: {
    from: { type: "string", short: "f" },
    to: { type: "string", short: "t", multiple: true },
    cc: { type: "string", multiple: true },
    bcc: { type: "string", multiple: true },
    subject: { type: "string", short: "s" },
    text: { type: "string" },
    "text-file": { type: "string" },
    html: { type: "string" },
    "html-file": { type: "string" },
    "reply-to": { type: "string" },
    template: { type: "string" },
    var: { type: "string", multiple: true },
    tag: { type: "string", multiple: true },
    header: { type: "string", multiple: true },
    attach: { type: "string", multiple: true },
    schedule: { type: "string" },
    "idempotency-key": { type: "string" },
  },
  help: [
    ["-f, --from <address>", 'Sender, such as "Acme <hello@acme.com>" (required)'],
    ["-t, --to <address>", "Recipient; repeat it or separate with commas (required)"],
    ["--cc <address>", "Cc recipient, the same way"],
    ["--bcc <address>", "Bcc recipient, the same way"],
    ["-s, --subject <text>", "Subject (required unless --template)"],
    ["--text <text>", "Plain-text body"],
    ["--text-file <path>", "Plain-text body from a file (- for standard input)"],
    ["--html <html>", "HTML body"],
    ["--html-file <path>", "HTML body from a file (- for standard input)"],
    ["--reply-to <address>", "Reply-To address"],
    ["--template <id>", "Template to render (tmpl_…)"],
    ["--var <name=value>", "Template variable; repeat for more"],
    ["--tag <name=value>", "Tag; repeat for more"],
    ['--header <"Name: value">', "Extra header; repeat for more"],
    ["--attach <path>", "Attach a file; repeat for more"],
    ["--schedule <time>", "Send later, at an RFC 3339 time such as 2026-11-01T09:00:00Z"],
    ["--idempotency-key <key>", "Send at most once for this key"],
  ],
  notes: `Example:
  postilon send -f hello@acme.com -t jane@example.com -s "Hi" --text "Hello"`,
  async run(ctx, { values }) {
    const from = str(values, "from");
    const to = list(values, "to");
    if (!from) throw new UsageError("--from is required.");
    if (!to) throw new UsageError("--to is required.");

    const params: SendEmailParams = { from, to: to.length === 1 ? to[0]! : to };
    const cc = list(values, "cc");
    const bcc = list(values, "bcc");
    if (cc) params.cc = cc;
    if (bcc) params.bcc = bcc;
    const subject = str(values, "subject");
    if (subject !== undefined) params.subject = subject;
    const text = await content(ctx, values, "text");
    const html = await content(ctx, values, "html");
    if (text !== undefined) params.text = text;
    if (html !== undefined) params.html = html;
    const replyTo = str(values, "reply-to");
    if (replyTo) params.reply_to = replyTo;
    const template = str(values, "template");
    if (template) params.template_id = template;
    const vars = pairs(values, "var", "=");
    if (vars.length) params.variables = Object.fromEntries(vars);
    const tags = pairs(values, "tag", "=");
    if (tags.length) params.tags = tags.map(([name, value]) => ({ name, value }));
    const headers = pairs(values, "header", ":");
    if (headers.length) params.headers = Object.fromEntries(headers);
    const attach = list(values, "attach");
    if (attach) {
      params.attachments = await Promise.all(
        attach.map(async (path) => ({
          filename: basename(path),
          content_type: CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
          content: (await readFile(resolve(ctx.io.cwd, path))).toString("base64"),
        })),
      );
    }
    const schedule = str(values, "schedule");
    if (schedule) params.scheduled_at = schedule;

    const idempotencyKey = str(values, "idempotency-key");
    const sent = await ctx.client().emails.send(params, idempotencyKey ? { idempotencyKey } : {});
    ctx.print(sent, () =>
      sent.status === "scheduled"
        ? `Scheduled ${sent.id} for ${when(sent.scheduled_at)} UTC (${sent.environment}).`
        : `Queued ${sent.id} to ${sent.to.join(", ")} (${sent.environment}).`,
    );
  },
};
