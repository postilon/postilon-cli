import { Postilon, PostilonError } from "@postilon/node";
import { configPath, readConfig } from "./config.js";

export const DEFAULT_API_URL = "https://api.postilon.com";

/** Everything a command touches outside the process: replaced by fakes in the tests. */
export interface Io {
  /** Writes to standard output as is. */
  write(text: string): void;
  /** Writes to standard error as is. */
  writeError(text: string): void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** True when standard input is a terminal, so `login` can prompt for the key. */
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  /** Asks for a value without echoing it. */
  promptSecret(question: string): Promise<string>;
}

/** A mistake in the command line itself: exits with 2 and points at `--help`. */
export class UsageError extends Error {}

export type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

export interface Args {
  values: Values;
  positionals: string[];
}

export interface Command {
  /** One line for the command list. */
  summary: string;
  /** Positional arguments, all required, such as `["<id>"]`. */
  args?: string[];
  options?: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }>;
  /** `[flags, description]` per option, for `--help`. */
  help?: [string, string][];
  /** Text after the options in `--help`, such as an example. */
  notes?: string;
  run(ctx: Context, args: Args): Promise<void>;
}

/** Commands under one name, such as `emails list`. */
export interface Group {
  summary: string;
  commands: Record<string, Command>;
}

export interface Key {
  value: string;
  /** `POSTILON_API_KEY` or the config file's path. */
  source: string;
}

export class Context {
  constructor(
    readonly io: Io,
    /** `--json`: print the API's responses instead of tables. */
    readonly json: boolean,
  ) {}

  line(text = ""): void {
    this.io.write(text + "\n");
  }

  /** Prints `data` as JSON with `--json`, else the text `human` makes from it. */
  print(data: unknown, human: () => string): void {
    this.line(this.json ? JSON.stringify(data, null, 2) : human());
  }

  /** The API key: `POSTILON_API_KEY` first, then the one `postilon login` saved. */
  key(): Key | undefined {
    const fromEnv = this.io.env.POSTILON_API_KEY?.trim();
    if (fromEnv) return { value: fromEnv, source: "POSTILON_API_KEY" };
    const saved = readConfig(this.io.env).api_key;
    if (saved) return { value: saved, source: configPath(this.io.env) };
    return undefined;
  }

  apiUrl(): string {
    return (this.io.env.POSTILON_API_URL || readConfig(this.io.env).api_url || DEFAULT_API_URL).replace(/\/+$/, "");
  }

  private requireKey(): string {
    const key = this.key();
    if (!key) throw new Error("No API key. Run `postilon login`, or set POSTILON_API_KEY.");
    return key.value;
  }

  client(): Postilon {
    return new Postilon(this.requireKey(), { baseUrl: this.apiUrl() });
  }

  /** For the endpoints `@postilon/node` does not cover yet (API keys, credits). */
  async request<T>(method: string, path: string, { query, body }: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    const url = new URL(this.apiUrl() + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.requireKey()}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      let code = "http_error";
      let message = `HTTP ${res.status}`;
      try {
        const err = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error;
        if (typeof err?.code === "string") code = err.code;
        if (typeof err?.message === "string" && err.message) message = err.message;
      } catch {
        // Not JSON: keep the generic code and message.
      }
      throw new PostilonError(res.status, code, message);
    }
    return JSON.parse(text) as T;
  }
}
