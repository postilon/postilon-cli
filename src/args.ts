import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { List } from "@postilon/node";
import { UsageError, type Command, type Context, type Values } from "./context.js";

export function str(values: Values, name: string): string | undefined {
  const v = values[name];
  return typeof v === "string" ? v : undefined;
}

/** A repeatable option that also takes commas: `--to a@x.com --to b@x.com,c@x.com`. */
export function list(values: Values, name: string): string[] | undefined {
  const v = values[name];
  if (!Array.isArray(v)) return undefined;
  const items = v.flatMap((x) => String(x).split(",")).map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

export function int(values: Values, name: string): number | undefined {
  const v = str(values, name);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name} must be a whole number.`);
  return Number(v);
}

/** `--var name=Jane` → `["name", "Jane"]`, split at the first `separator`. */
export function pairs(values: Values, name: string, separator: string): [string, string][] {
  const v = values[name];
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    const text = String(item);
    const at = text.indexOf(separator);
    if (at <= 0) throw new UsageError(`--${name} takes name${separator}value, not "${text}".`);
    return [text.slice(0, at).trim(), text.slice(at + separator.length).trim()];
  });
}

/** `on` or `off`. */
export function onOff(values: Values, name: string): boolean | undefined {
  const v = str(values, name);
  if (v === undefined) return undefined;
  if (v === "on") return true;
  if (v === "off") return false;
  throw new UsageError(`--${name} takes on or off.`);
}

export const pageOptions: Command["options"] = { limit: { type: "string" }, offset: { type: "string" } };
export const pageHelp: [string, string][] = [
  ["--limit <n>", "Items per page (default 100, at most 1000)"],
  ["--offset <n>", "Items to skip"],
];

export function page(values: Values): { limit?: number; offset?: number } {
  return { limit: int(values, "limit"), offset: int(values, "offset") };
}

/** `--html` or `--html-file <path>` (`-` reads standard input), not both. */
export async function content(ctx: Context, values: Values, name: string): Promise<string | undefined> {
  const inline = str(values, name);
  const file = str(values, `${name}-file`);
  if (inline !== undefined && file !== undefined) throw new UsageError(`Use --${name} or --${name}-file, not both.`);
  if (file === undefined) return inline;
  return file === "-" ? ctx.io.readStdin() : readFile(resolve(ctx.io.cwd, file), "utf8");
}

/** Walks a list page by page until `match` finds an item. */
export async function find<T>(fetchPage: (offset: number) => Promise<List<T>>, match: (item: T) => boolean): Promise<T | undefined> {
  for (let offset = 0; ; ) {
    const list = await fetchPage(offset);
    const hit = list.data.find(match);
    if (hit || !list.has_more || list.count === 0) return hit;
    offset += list.count;
  }
}
