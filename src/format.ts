import type { List } from "@postilon/node";

/** Columns padded to their widest cell; the last column is not padded. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

/** Label/value rows; rows without a value are left out. */
export function details(rows: [string, string | number | null | undefined][]): string {
  const shown = rows.filter((r): r is [string, string | number] => r[1] !== undefined && r[1] !== null && r[1] !== "");
  const width = Math.max(...shown.map(([label]) => label.length));
  return shown.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n");
}

/** A list page as a table, with a hint for the next page. `offset` is the one requested. */
export function listTable<T>(list: List<T>, offset: number, noun: string, headers: string[], row: (item: T) => string[]): string {
  if (list.data.length === 0) return `No ${noun}.`;
  let text = table(headers, list.data.map(row));
  if (list.has_more) {
    text += `\n\n${offset + 1}–${offset + list.count} of ${list.total}. Next page: --offset ${offset + list.count}`;
  }
  return text;
}

/** `2026-10-27T09:14:02Z` → `2026-10-27 09:14` (UTC). */
export function when(time: string | null | undefined): string {
  return time ? time.slice(0, 16).replace("T", " ") : "";
}

export function truncate(text: string, max = 48): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function number(n: number): string {
  return n.toLocaleString("en-US");
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** `ps_test_abcd1234…` → `ps_test_abcd…`: enough to tell keys apart, not to use one. */
export function maskKey(key: string): string {
  const m = /^(ps_(?:live|test)_)(.*)$/.exec(key);
  return m ? `${m[1]}${(m[2] ?? "").slice(0, 4)}…` : `${key.slice(0, 4)}…`;
}
