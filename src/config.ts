import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What `postilon login` saves. */
export interface Config {
  api_key?: string;
  api_url?: string;
}

type Env = Record<string, string | undefined>;

/** `$XDG_CONFIG_HOME/postilon/config.json`, by default `~/.config/postilon/config.json`. */
export function configPath(env: Env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "postilon", "config.json");
}

export function readConfig(env: Env): Config {
  const path = configPath(env);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    return JSON.parse(text) as Config;
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it, or delete it and run \`postilon login\` again.`);
  }
}

/** Writes the config readable by its owner only, as it holds the API key. */
export function writeConfig(env: Env, config: Config): string {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync keeps the mode of a file that already exists
  return path;
}

/** Deletes the config; false when there was none. */
export function deleteConfig(env: Env): boolean {
  const path = configPath(env);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
