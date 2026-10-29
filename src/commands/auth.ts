import { Postilon } from "@postilon/node";
import { str } from "../args.js";
import { configPath, deleteConfig, writeConfig } from "../config.js";
import { DEFAULT_API_URL, UsageError, type Command } from "../context.js";
import { details, maskKey } from "../format.js";

const environment = (key: string) => (key.startsWith("ps_test_") ? "test" : key.startsWith("ps_live_") ? "live" : "unknown");

export const login: Command = {
  summary: "Save an API key in your config file",
  options: { "api-url": { type: "string" } },
  help: [["--api-url <url>", `The API to use with this key (default ${DEFAULT_API_URL})`]],
  notes: `Paste the key at the prompt, or pipe it in: echo "$KEY" | postilon login
The key is checked, then saved to ~/.config/postilon/config.json (readable only by you).`,
  async run(ctx, { values }) {
    const input = ctx.io.stdinIsTTY ? await ctx.io.promptSecret("API key: ") : await ctx.io.readStdin();
    const key = input.trim();
    if (!/^ps_(live|test)_\S+$/.test(key)) throw new UsageError("That is not a Postilon API key (ps_live_… or ps_test_…).");
    const apiUrl = str(values, "api-url")?.replace(/\/+$/, "");

    // GET /v1/emails answers keys with full and sending access alike.
    await new Postilon(key, { baseUrl: apiUrl || ctx.io.env.POSTILON_API_URL || DEFAULT_API_URL }).emails.list({ limit: 1 });

    const path = writeConfig(ctx.io.env, apiUrl ? { api_key: key, api_url: apiUrl } : { api_key: key });
    ctx.print({ api_key: maskKey(key), environment: environment(key), config: path }, () => {
      let text = `Saved ${maskKey(key)} (${environment(key)}) to ${path}.`;
      if (ctx.io.env.POSTILON_API_KEY) text += "\nPOSTILON_API_KEY is set, and it is used instead of the saved key.";
      return text;
    });
  },
};

export const logout: Command = {
  summary: "Remove the saved API key",
  async run(ctx) {
    const path = configPath(ctx.io.env);
    const removed = deleteConfig(ctx.io.env);
    ctx.print({ removed, config: path }, () => {
      let text = removed ? `Removed ${path}.` : "No saved API key.";
      if (ctx.io.env.POSTILON_API_KEY) text += "\nPOSTILON_API_KEY is still set in this shell.";
      return text;
    });
  },
};

export const whoami: Command = {
  summary: "Show which API key and API are in use",
  async run(ctx) {
    const key = ctx.key();
    if (!key) throw new Error("No API key. Run `postilon login`, or set POSTILON_API_KEY.");
    const info = { api_key: maskKey(key.value), environment: environment(key.value), source: key.source, api_url: ctx.apiUrl() };
    ctx.print(info, () =>
      details([
        ["API key", info.api_key],
        ["Environment", info.environment],
        ["From", info.source],
        ["API", info.api_url],
      ]),
    );
  },
};
