import type { DnsRecord, Domain, UpdateDomainParams } from "@postilon/node";
import { find, onOff, page, pageHelp, pageOptions, str } from "../args.js";
import { UsageError, type Command, type Context, type Group } from "../context.js";
import { details, listTable, table, when } from "../format.js";

/** A `dom_…` ID as is, or the ID of the domain with that name. */
export async function domainId(ctx: Context, nameOrId: string): Promise<string> {
  if (nameOrId.startsWith("dom_")) return nameOrId;
  const name = nameOrId.toLowerCase();
  const client = ctx.client();
  const domain = await find((offset) => client.domains.list({ limit: 1000, offset }), (d) => d.domain_name.toLowerCase() === name);
  if (!domain) throw new Error(`No domain named ${nameOrId} in this workspace.`);
  return domain.id;
}

function records(domain: Domain): string {
  const all: DnsRecord[] = [...domain.dns_records, ...(domain.inbound_record ? [domain.inbound_record] : [])];
  return table(
    ["TYPE", "NAME", "STATUS", "VALUE"],
    all.map((r) => [r.type, r.name, r.required === false ? `${r.status} (recommended)` : r.status, r.priority ? `${r.priority} ${r.value}` : r.value]),
  );
}

function domainDetails(d: Domain): string {
  return (
    details([
      ["ID", d.id],
      ["Domain", d.domain_name],
      ["Status", d.status],
      ["Open tracking", d.open_tracking_enabled ? "on" : "off"],
      ["Click tracking", d.click_tracking_enabled ? "on" : "off"],
      ["Inbound domain", d.inbound_domain || "off"],
      ["Verified", when(d.verified_at)],
      ["Created", when(d.created_at)],
    ]) +
    "\n\n" +
    records(d)
  );
}

const list: Command = {
  summary: "List domains",
  options: pageOptions,
  help: pageHelp,
  async run(ctx, { values }) {
    const paging = page(values);
    const domains = await ctx.client().domains.list(paging);
    ctx.print(domains, () =>
      listTable(domains, paging.offset ?? 0, "domains", ["ID", "DOMAIN", "STATUS", "INBOUND", "CREATED"], (d) => [
        d.id,
        d.domain_name,
        d.status,
        d.inbound_domain || "-",
        when(d.created_at),
      ]),
    );
  },
};

const get: Command = {
  summary: "Show a domain and its DNS records",
  args: ["<domain>"],
  notes: "<domain> is a name such as acme.com, or an ID (dom_…).",
  async run(ctx, { positionals: [domain] }) {
    const d = await ctx.client().domains.get(await domainId(ctx, domain!));
    ctx.print(d, () => domainDetails(d));
  },
};

const add: Command = {
  summary: "Add a domain to send from",
  args: ["<name>"],
  async run(ctx, { positionals: [name] }) {
    const d = await ctx.client().domains.create({ domain_name: name! });
    ctx.print(d, () => `${domainDetails(d)}\n\nAdd these records at your DNS provider, then run: postilon domains verify ${d.domain_name}`);
  },
};

const verify: Command = {
  summary: "Check a domain's DNS records now",
  args: ["<domain>"],
  async run(ctx, { positionals: [domain] }) {
    const result = await ctx.client().domains.verify(await domainId(ctx, domain!));
    const d = result.domain;
    ctx.print(result, () =>
      d.status === "verified"
        ? `${d.domain_name} is verified.\n\n${records(d)}`
        : `${d.domain_name} is not verified yet: some records are not in DNS. DNS changes can take up to a few hours to show.\n\n${records(d)}`,
    );
  },
};

const update: Command = {
  summary: "Change tracking or inbound email for a domain",
  args: ["<domain>"],
  options: {
    "open-tracking": { type: "string" },
    "click-tracking": { type: "string" },
    "inbound-domain": { type: "string" },
  },
  help: [
    ["--open-tracking <on|off>", "Track opens"],
    ["--click-tracking <on|off>", "Track clicks"],
    ["--inbound-domain <name>", 'Receive email on this domain or a subdomain; "" turns inbound off'],
  ],
  async run(ctx, { values, positionals: [domain] }) {
    const params: UpdateDomainParams = {};
    const open = onOff(values, "open-tracking");
    const click = onOff(values, "click-tracking");
    const inbound = str(values, "inbound-domain");
    if (open !== undefined) params.open_tracking_enabled = open;
    if (click !== undefined) params.click_tracking_enabled = click;
    if (inbound !== undefined) params.inbound_domain = inbound;
    if (Object.keys(params).length === 0) throw new UsageError("Pass --open-tracking, --click-tracking or --inbound-domain.");
    const d = await ctx.client().domains.update(await domainId(ctx, domain!), params);
    ctx.print(d, () => domainDetails(d));
  },
};

const remove: Command = {
  summary: "Remove a domain",
  args: ["<domain>"],
  async run(ctx, { positionals: [domain] }) {
    const id = await domainId(ctx, domain!);
    const res = await ctx.client().domains.delete(id);
    ctx.print(res, () => `Removed ${domain}.`);
  },
};

export const domains: Group = { summary: "Add, verify and manage sending domains", commands: { list, get, add, verify, update, remove } };
