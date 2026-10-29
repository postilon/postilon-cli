import { find, page, pageHelp, pageOptions } from "../args.js";
import type { Command, Group } from "../context.js";
import { listTable, when } from "../format.js";

const list: Command = {
  summary: "List suppressed addresses",
  options: pageOptions,
  help: pageHelp,
  async run(ctx, { values }) {
    const paging = page(values);
    const suppressions = await ctx.client().suppressions.list(paging);
    ctx.print(suppressions, () =>
      listTable(suppressions, paging.offset ?? 0, "suppressed addresses", ["ID", "ADDRESS", "REASON", "CREATED"], (s) => [
        s.id,
        s.email_address,
        s.reason,
        when(s.created_at),
      ]),
    );
  },
};

const add: Command = {
  summary: "Stop sending to an address",
  args: ["<address>"],
  async run(ctx, { positionals: [address] }) {
    const s = await ctx.client().suppressions.create({ email_address: address! });
    ctx.print(s, () => `Suppressed ${s.email_address} (${s.id}).`);
  },
};

const remove: Command = {
  summary: "Allow sending to an address again",
  args: ["<address>"],
  notes: "<address> is the email address, or the suppression's ID (sup_…).",
  async run(ctx, { positionals: [address] }) {
    const client = ctx.client();
    let id = address!;
    if (!id.startsWith("sup_")) {
      const wanted = id.toLowerCase();
      const hit = await find((offset) => client.suppressions.list({ limit: 1000, offset }), (s) => s.email_address.toLowerCase() === wanted);
      if (!hit) throw new Error(`${address} is not suppressed.`);
      id = hit.id;
    }
    const res = await client.suppressions.delete(id);
    ctx.print(res, () => `Removed the suppression of ${address}.`);
  },
};

export const suppressions: Group = { summary: "Manage addresses Postilon does not send to", commands: { list, add, remove } };
