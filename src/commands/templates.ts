import type { CreateTemplateParams, Template } from "@postilon/node";
import { content, page, pageHelp, pageOptions, str } from "../args.js";
import { UsageError, type Command, type Context, type Group, type Values } from "../context.js";
import { details, listTable, truncate, when } from "../format.js";

const contentOptions: Command["options"] = {
  subject: { type: "string", short: "s" },
  html: { type: "string" },
  "html-file": { type: "string" },
  text: { type: "string" },
  "text-file": { type: "string" },
};

const contentHelp: [string, string][] = [
  ["-s, --subject <text>", "Subject; may use {{ variables }}"],
  ["--html <html>", "HTML body"],
  ["--html-file <path>", "HTML body from a file (- for standard input)"],
  ["--text <text>", "Plain-text body"],
  ["--text-file <path>", "Plain-text body from a file (- for standard input)"],
];

async function templateParams(ctx: Context, values: Values): Promise<Partial<CreateTemplateParams>> {
  const params: Partial<CreateTemplateParams> = {};
  const subject = str(values, "subject");
  const html = await content(ctx, values, "html");
  const text = await content(ctx, values, "text");
  if (subject !== undefined) params.subject_template = subject;
  if (html !== undefined) params.html_template = html;
  if (text !== undefined) params.text_template = text;
  return params;
}

function templateDetails(t: Template): string {
  let text = details([
    ["ID", t.id],
    ["Name", t.name],
    ["Subject", t.subject_template],
    ["Variables", t.variables?.join(", ")],
    ["Updated", when(t.updated_at)],
    ["Created", when(t.created_at)],
  ]);
  if (t.text_template) text += `\n\nText:\n${t.text_template.trimEnd()}`;
  if (t.html_template) text += `\n\nHTML:\n${t.html_template.trimEnd()}`;
  return text;
}

const list: Command = {
  summary: "List templates",
  options: pageOptions,
  help: pageHelp,
  async run(ctx, { values }) {
    const paging = page(values);
    const templates = await ctx.client().templates.list(paging);
    ctx.print(templates, () =>
      listTable(templates, paging.offset ?? 0, "templates", ["ID", "NAME", "SUBJECT", "UPDATED"], (t) => [
        t.id,
        truncate(t.name, 32),
        truncate(t.subject_template),
        when(t.updated_at),
      ]),
    );
  },
};

const get: Command = {
  summary: "Show a template",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const t = await ctx.client().templates.get(id!);
    ctx.print(t, () => templateDetails(t));
  },
};

const create: Command = {
  summary: "Create a template",
  args: ["<name>"],
  options: contentOptions,
  help: contentHelp,
  notes: `Example:
  postilon templates create "Welcome" -s "Welcome, {{ name }}" --html-file welcome.html`,
  async run(ctx, { values, positionals: [name] }) {
    const t = await ctx.client().templates.create({ name: name!, ...(await templateParams(ctx, values)) });
    ctx.print(t, () => templateDetails(t));
  },
};

const update: Command = {
  summary: "Change a template",
  args: ["<id>"],
  options: { ...contentOptions, name: { type: "string" } },
  help: [["--name <name>", "New name"], ...contentHelp],
  async run(ctx, { values, positionals: [id] }) {
    const params = await templateParams(ctx, values);
    const name = str(values, "name");
    if (name !== undefined) params.name = name;
    if (Object.keys(params).length === 0) throw new UsageError("Pass at least one of --name, --subject, --html, --text.");
    const t = await ctx.client().templates.update(id!, params);
    ctx.print(t, () => templateDetails(t));
  },
};

const remove: Command = {
  summary: "Delete a template",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const res = await ctx.client().templates.delete(id!);
    ctx.print(res, () => `Deleted ${id}.`);
  },
};

export const templates: Group = { summary: "Manage email templates", commands: { list, get, create, update, remove } };
