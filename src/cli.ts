import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { PostilonError } from "@postilon/node";
import { apiKeys, credits } from "./commands/api-keys.js";
import { login, logout, whoami } from "./commands/auth.js";
import { domains } from "./commands/domains.js";
import { emails } from "./commands/emails.js";
import { inbound } from "./commands/inbound.js";
import { send } from "./commands/send.js";
import { suppressions } from "./commands/suppressions.js";
import { templates } from "./commands/templates.js";
import { webhooks } from "./commands/webhooks.js";
import { Context, UsageError, type Command, type Group, type Io, type Values } from "./context.js";

export const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const COMMANDS: Record<string, Command | Group> = {
  login,
  logout,
  whoami,
  send,
  emails,
  domains,
  inbound,
  webhooks,
  templates,
  suppressions,
  "api-keys": apiKeys,
  credits,
};

const GLOBAL_HELP: [string, string][] = [
  ["--json", "Print the API's JSON response"],
  ["-h, --help", "Show help"],
];

const isGroup = (entry: Command | Group): entry is Group => "commands" in entry;

function rows(items: [string, string][]): string {
  const width = Math.max(...items.map(([left]) => left.length));
  return items.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`).join("\n");
}

function rootHelp(): string {
  return `Postilon CLI ${VERSION}: send and manage email from your terminal.

Usage: postilon <command> [options]

Commands:
${rows(Object.entries(COMMANDS).map(([name, entry]) => [name, entry.summary]))}

Options:
${rows([...GLOBAL_HELP, ["-v, --version", "Show the version"]])}

The API key comes from POSTILON_API_KEY, or from \`postilon login\`.
Docs: https://postilon.com/docs/cli`;
}

function groupHelp(name: string, group: Group): string {
  return `${group.summary}.

Usage: postilon ${name} <command> [options]

Commands:
${rows(Object.entries(group.commands).map(([sub, cmd]) => [[sub, ...(cmd.args ?? [])].join(" "), cmd.summary]))}

Run \`postilon ${name} <command> --help\` for its options.`;
}

function commandHelp(path: string, cmd: Command): string {
  const usage = ["postilon", path, ...(cmd.args ?? []), "[options]"].join(" ");
  let text = `${cmd.summary}.\n\nUsage: ${usage}\n\nOptions:\n${rows([...(cmd.help ?? []), ...GLOBAL_HELP])}`;
  if (cmd.notes) text += `\n\n${cmd.notes}`;
  return text;
}

/** Runs one command line (without `node` and the script) and returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const print = (text: string) => io.write(text + "\n");
  let path = "";
  try {
    const [name, ...rest] = argv;
    if (name === undefined || name === "-h" || name === "--help" || name === "help") {
      print(rootHelp());
      return 0;
    }
    if (name === "-v" || name === "--version") {
      print(VERSION);
      return 0;
    }
    const entry = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (!entry) throw new UsageError(`Unknown command "${name}".`);

    let cmd: Command;
    let args = rest;
    path = name;
    if (isGroup(entry)) {
      const [sub, ...subRest] = rest;
      if (sub === undefined || sub === "-h" || sub === "--help") {
        print(groupHelp(name, entry));
        return 0;
      }
      const found = Object.hasOwn(entry.commands, sub) ? entry.commands[sub] : undefined;
      if (!found) throw new UsageError(`Unknown command "${name} ${sub}".`);
      cmd = found;
      args = subRest;
      path = `${name} ${sub}`;
    } else {
      cmd = entry;
    }

    let parsed: { values: Values; positionals: string[] };
    try {
      parsed = parseArgs({
        args,
        options: { ...cmd.options, json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
        allowPositionals: true,
        strict: true,
      }) as { values: Values; positionals: string[] };
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
    if (parsed.values.help) {
      print(commandHelp(path, cmd));
      return 0;
    }
    const expected = cmd.args ?? [];
    if (parsed.positionals.length < expected.length) throw new UsageError(`Missing ${expected.slice(parsed.positionals.length).join(" ")}.`);
    if (parsed.positionals.length > expected.length) throw new UsageError(`Unexpected argument "${parsed.positionals[expected.length]}".`);

    await cmd.run(new Context(io, parsed.values.json === true), parsed);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.writeError(`Error: ${err.message}\nSee: postilon ${path ? path + " " : ""}--help\n`);
      return 2;
    }
    if (err instanceof PostilonError) {
      io.writeError(`Error: ${err.message} (${err.code}, HTTP ${err.status})\n`);
      return 1;
    }
    const e = err as Error;
    // fetch puts the reason it failed (DNS, a refused connection) in `cause`.
    const cause = e.cause instanceof Error ? `: ${e.cause.message}` : "";
    io.writeError(`Error: ${e.message}${cause}\n`);
    return 1;
  }
}
