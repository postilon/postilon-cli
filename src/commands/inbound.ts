import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { page, pageHelp, pageOptions, str } from "../args.js";
import { UsageError, type Command, type Context, type Group } from "../context.js";
import { bytes, details, listTable, table, truncate, when } from "../format.js";

/** Writes to `--output`, replacing a file there; a name taken from the email itself never replaces one. */
async function save(ctx: Context, data: string | Uint8Array, output: string | undefined, fallbackName: string): Promise<string> {
  const path = resolve(ctx.io.cwd, output ?? fallbackName);
  try {
    await writeFile(path, data, { flag: output ? "w" : "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${path} already exists. Choose a file with --output.`);
    throw err;
  }
  return path;
}

const list: Command = {
  summary: "List received email, newest first",
  options: { ...pageOptions, search: { type: "string", short: "q" } },
  help: [["-q, --search <text>", "Search the subject, sender and recipient"], ...pageHelp],
  async run(ctx, { values }) {
    const paging = page(values);
    const inbound = await ctx.client().inbound.list({ ...paging, q: str(values, "search") });
    ctx.print(inbound, () =>
      listTable(inbound, paging.offset ?? 0, "received email", ["ID", "FROM", "TO", "SUBJECT", "RECEIVED"], (m) => [
        m.id,
        truncate(m.from, 32),
        truncate(m.recipient, 32),
        truncate(m.subject),
        when(m.created_at),
      ]),
    );
  },
};

const get: Command = {
  summary: "Show a received email",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const m = await ctx.client().inbound.get(id!);
    ctx.print(m, () => {
      let text = details([
        ["ID", m.id],
        ["From", m.from],
        ["To", m.recipient],
        ["Cc", m.cc?.join(", ")],
        ["Reply-To", m.reply_to],
        ["Subject", m.subject],
        ["Received", when(m.created_at)],
        ["Size", bytes(m.size_bytes)],
        ["SPF / DKIM / DMARC", `${m.spf} / ${m.dkim} / ${m.dmarc}`],
        ["Spam", m.spam ? "yes" : "no"],
        ["Content deleted", when(m.content_purged_at)],
      ]);
      if (m.attachments?.length) {
        text += "\n\n" + table(["INDEX", "NAME", "TYPE", "SIZE"], m.attachments.map((a, i) => [String(i), a.filename, a.content_type, bytes(a.size)]));
      }
      if (m.text) text += "\n\n" + m.text.trimEnd();
      return text;
    });
  },
};

const raw: Command = {
  summary: "Print or save the message as received (.eml)",
  args: ["<id>"],
  options: { output: { type: "string", short: "o" } },
  help: [["-o, --output <path>", "Save to this file instead of printing it"]],
  async run(ctx, { values, positionals: [id] }) {
    const message = await ctx.client().inbound.raw(id!);
    const output = str(values, "output");
    if (output === undefined) {
      ctx.io.write(message);
      return;
    }
    const path = await save(ctx, message, output, "");
    ctx.print({ path }, () => `Saved ${path}.`);
  },
};

const attachment: Command = {
  summary: "Save an attachment of a received email",
  args: ["<id>", "<index>"],
  options: { output: { type: "string", short: "o" } },
  help: [["-o, --output <path>", "Where to save it (default: its own name, in this folder)"]],
  notes: "<index> counts from 0, as in `postilon inbound get <id>`.",
  async run(ctx, { values, positionals: [id, index] }) {
    if (!/^\d+$/.test(index!)) throw new UsageError("<index> must be a whole number, from 0.");
    const client = ctx.client();
    const output = str(values, "output");
    let name = "";
    if (output === undefined) {
      const meta = (await client.inbound.get(id!)).attachments?.[Number(index)];
      if (!meta) throw new Error(`${id} has no attachment ${index}.`);
      // The sender chose this name: keep only its last part, so it lands in this folder.
      const base = basename(meta.filename);
      name = base && base !== "." && base !== ".." ? base : `attachment-${index}`;
    }
    const data = await client.inbound.attachment(id!, Number(index));
    const path = await save(ctx, data, output, name);
    ctx.print({ path, size: data.byteLength }, () => `Saved ${path} (${bytes(data.byteLength)}).`);
  },
};

export const inbound: Group = { summary: "Read email received on your inbound domains", commands: { list, get, raw, attachment } };
