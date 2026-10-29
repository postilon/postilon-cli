// `@postilon/node` 1.2.0 has no API-key or credit methods, so these call the API directly.
import type { Deleted, List } from "@postilon/node";
import { int, page, pageHelp, pageOptions, str } from "../args.js";
import { UsageError, type Command, type Group } from "../context.js";
import { details, listTable, number, when } from "../format.js";
import { domainId } from "./domains.js";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scope: "full_access" | "sending_access";
  environment: "live" | "test";
  domain_id?: string;
  status?: "active" | "revoked" | "expired";
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
  created_at: string;
}

const list: Command = {
  summary: "List API keys (without their secret)",
  options: pageOptions,
  help: pageHelp,
  async run(ctx, { values }) {
    const paging = page(values);
    const keys = await ctx.request<List<ApiKey>>("GET", "/v1/api-keys", { query: paging });
    ctx.print(keys, () =>
      listTable(keys, paging.offset ?? 0, "API keys", ["ID", "NAME", "KEY", "SCOPE", "STATUS", "LAST USED"], (k) => [
        k.id,
        k.name,
        k.key_prefix,
        k.scope,
        k.status ?? "active",
        when(k.last_used_at) || "never",
      ]),
    );
  },
};

const create: Command = {
  summary: "Create an API key",
  args: ["<name>"],
  options: {
    environment: { type: "string" },
    scope: { type: "string" },
    domain: { type: "string" },
    "expires-in-days": { type: "string" },
  },
  help: [
    ["--environment <live|test>", "live sends real mail; test delivers nothing (default live)"],
    ["--scope <scope>", "full_access or sending_access (default full_access)"],
    ["--domain <domain>", "Only send from this domain (a name or dom_…)"],
    ["--expires-in-days <n>", "Expire after n days (default never)"],
  ],
  async run(ctx, { values, positionals: [name] }) {
    const environment = str(values, "environment");
    const scope = str(values, "scope");
    if (environment !== undefined && environment !== "live" && environment !== "test") throw new UsageError("--environment takes live or test.");
    if (scope !== undefined && scope !== "full_access" && scope !== "sending_access") throw new UsageError("--scope takes full_access or sending_access.");
    const domain = str(values, "domain");
    const body = {
      name: name!,
      ...(environment && { environment }),
      ...(scope && { scope }),
      ...(domain && { domain_id: await domainId(ctx, domain) }),
      ...(values["expires-in-days"] !== undefined && { expires_in_days: int(values, "expires-in-days") }),
    };
    const res = await ctx.request<{ api_key: ApiKey; token: string }>("POST", "/v1/api-keys", { body });
    const k = res.api_key;
    ctx.print(res, () =>
      details([
        ["ID", k.id],
        ["Name", k.name],
        ["Environment", k.environment],
        ["Scope", k.scope],
        ["Domain", k.domain_id],
        ["Expires", when(k.expires_at)],
      ]) + `\n\n${res.token}\n\nThis is the only time the key is shown. Store it somewhere safe.`,
    );
  },
};

const revoke: Command = {
  summary: "Revoke an API key at once",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const k = await ctx.request<ApiKey>("POST", `/v1/api-keys/${encodeURIComponent(id!)}/revoke`);
    ctx.print(k, () => `Revoked ${k.name} (${k.id}).`);
  },
};

const remove: Command = {
  summary: "Delete an API key",
  args: ["<id>"],
  async run(ctx, { positionals: [id] }) {
    const res = await ctx.request<Deleted>("DELETE", `/v1/api-keys/${encodeURIComponent(id!)}`);
    ctx.print(res, () => `Deleted ${id}.`);
  },
};

export const apiKeys: Group = { summary: "Manage API keys (needs a full-access key)", commands: { list, create, revoke, remove } };

interface Credits {
  credit_balance: number;
  next_expiry: { at: string; credits: number } | null;
  live_sent_24h: number;
}

export const credits: Command = {
  summary: "Show the credit balance",
  async run(ctx) {
    const c = await ctx.request<Credits>("GET", "/v1/credits");
    ctx.print(c, () =>
      details([
        ["Balance", `${number(c.credit_balance)} credits`],
        ["Next expiry", c.next_expiry ? `${number(c.next_expiry.credits)} credits on ${when(c.next_expiry.at).slice(0, 10)}` : "none"],
        ["Live sent (24h)", number(c.live_sent_24h)],
      ]) + "\n\nBuy credits in the dashboard under Settings → Billing.",
    );
  },
};
