#!/usr/bin/env node
import { run } from "./cli.js";
import type { Io } from "./context.js";

const { stdin, stdout, stderr } = process;

// `postilon emails list | head` closes the pipe early; that is not an error.
stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a line from the terminal without showing it. */
function promptSecret(question: string): Promise<string> {
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          done();
          resolve(value);
          return;
        }
        if (ch === "\u0003" || ch === "\u0004") {
          done();
          reject(new Error("Canceled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const io: Io = {
  write: (text) => stdout.write(text),
  writeError: (text) => stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
  stdinIsTTY: Boolean(stdin.isTTY),
  readStdin,
  promptSecret,
};

process.exitCode = await run(process.argv.slice(2), io);
