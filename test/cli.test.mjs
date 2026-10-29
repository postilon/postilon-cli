// Runs the built CLI (dist) with a fake terminal, a fake fetch and a temporary config folder.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { run } from "../dist/cli.js";

const KEY = "ps_test_abc123def456";
const realFetch = globalThis.fetch;
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "postilon-cli-"));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

/** Replaces fetch with one that records each call and answers with `respond(call)`. */
function mockFetch(respond = () => json(200, {})) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = {
      url,
      method: init.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: new Headers(init.headers),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    return respond(call);
  };
  return calls;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const page = (data, extra = {}) => ({ object: "list", data, count: data.length, total: data.length, has_more: false, ...extra });

/** Runs `postilon <argv>`; `env` defaults to a test key and the temporary config folder. */
async function cli(argv, { env = { POSTILON_API_KEY: KEY }, stdin = "", stdinIsTTY = false, secret = "" } = {}) {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    write: (t) => (stdout += t),
    writeError: (t) => (stderr += t),
    env: { XDG_CONFIG_HOME: dir, ...env },
    cwd: dir,
    stdinIsTTY,
    readStdin: async () => stdin,
    promptSecret: async () => secret,
  });
  return { code, stdout, stderr };
}

describe("help and usage", () => {
  it("lists the commands, a group's commands and a command's options", async () => {
    const root = await cli(["--help"]);
    assert.equal(root.code, 0);
    for (const name of ["login", "send", "emails", "domains", "inbound", "webhooks", "templates", "suppressions", "api-keys", "credits"]) {
      assert.match(root.stdout, new RegExp(`^  ${name} `, "m"));
    }
    assert.match((await cli(["domains"])).stdout, /verify <domain>/);
    assert.match((await cli(["send", "--help"])).stdout, /--html-file <path>/);
  });

  it("exits with 2 and makes no request on a usage error", async () => {
    const calls = mockFetch();
    for (const argv of [["nope"], ["emails", "nope"], ["emails", "get"], ["emails", "get", "a", "b"], ["send", "--bogus"], ["send", "-t", "jane@example.com"]]) {
      const res = await cli(argv);
      assert.equal(res.code, 2, argv.join(" "));
      assert.match(res.stderr, /^Error: .*\nSee: postilon /);
    }
    assert.equal(calls.length, 0);
  });
});

describe("API key", () => {
  it("login checks the key from standard input and saves it readable only by its owner", async () => {
    const calls = mockFetch(() => json(200, page([])));
    const res = await cli(["login"], { env: {}, stdin: `${KEY}\n` });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(calls[0].path, "/v1/emails");
    assert.equal(calls[0].query.limit, "1");
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${KEY}`);
    const path = join(dir, "postilon", "config.json");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { api_key: KEY });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.match(res.stdout, /Saved ps_test_abc1… \(test\)/);
    assert.doesNotMatch(res.stdout, /def456/);

    const who = await cli(["whoami"], { env: {} });
    assert.match(who.stdout, /ps_test_abc1…/);
    assert.match(who.stdout, /config\.json/);

    assert.match((await cli(["logout"], { env: {} })).stdout, /Removed/);
    assert.equal(existsSync(path), false);
  });

  it("login prompts on a terminal, keeps --api-url and refuses what is not a key", async () => {
    const calls = mockFetch(() => json(200, page([])));
    const res = await cli(["login", "--api-url", "https://api.staging.postilon.com/"], { env: {}, stdinIsTTY: true, secret: KEY });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(calls[0].url.origin, "https://api.staging.postilon.com");
    const config = JSON.parse(readFileSync(join(dir, "postilon", "config.json"), "utf8"));
    assert.equal(config.api_url, "https://api.staging.postilon.com");

    assert.equal((await cli(["login"], { env: {}, stdin: "hunter2" })).code, 2);
    assert.equal(calls.length, 1);
  });

  it("does not save a key the API refuses", async () => {
    mockFetch(() => json(401, { error: { code: "invalid_api_key", message: "Invalid API key." } }));
    const res = await cli(["login"], { env: {}, stdin: KEY });
    assert.equal(res.code, 1);
    assert.equal(res.stderr, "Error: Invalid API key. (invalid_api_key, HTTP 401)\n");
    assert.equal(existsSync(join(dir, "postilon", "config.json")), false);
  });

  it("prefers POSTILON_API_KEY and POSTILON_API_URL to the config file", async () => {
    const calls = mockFetch(() => json(200, page([])));
    await cli(["login"], { env: {}, stdin: "ps_live_saved" });
    await cli(["emails", "list"], { env: { POSTILON_API_KEY: KEY, POSTILON_API_URL: "http://localhost:8080" } });
    assert.equal(calls[1].headers.get("authorization"), `Bearer ${KEY}`);
    assert.equal(calls[1].url.origin, "http://localhost:8080");
    await cli(["emails", "list"], { env: {} });
    assert.equal(calls[2].headers.get("authorization"), "Bearer ps_live_saved");
  });

  it("says how to add a key when there is none", async () => {
    const res = await cli(["emails", "list"], { env: {} });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /postilon login/);
  });
});

describe("send", () => {
  it("builds the request from the options and files", async () => {
    writeFileSync(join(dir, "body.html"), "<p>Hi {{ name }}</p>");
    writeFileSync(join(dir, "invoice.pdf"), "%PDF-1");
    const calls = mockFetch(() =>
      json(202, { id: "msg_1", status: "queued", from: "hello@acme.com", to: ["jane@example.com", "joe@example.com"], environment: "test" }),
    );
    const res = await cli([
      "send",
      "-f", "Acme <hello@acme.com>",
      "-t", "jane@example.com,joe@example.com",
      "--cc", "cc@example.com",
      "-s", "Receipt",
      "--html-file", "body.html",
      "--text", "Hi",
      "--reply-to", "support@acme.com",
      "--var", "name=Jane",
      "--tag", "category=receipt",
      "--header", "X-Entity-Ref-ID: order-123",
      "--attach", "invoice.pdf",
      "--idempotency-key", "order-123",
    ]);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, "Queued msg_1 to jane@example.com, joe@example.com (test).\n");
    const [call] = calls;
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/v1/emails");
    assert.equal(call.headers.get("idempotency-key"), "order-123");
    assert.deepEqual(call.body, {
      from: "Acme <hello@acme.com>",
      to: ["jane@example.com", "joe@example.com"],
      cc: ["cc@example.com"],
      subject: "Receipt",
      text: "Hi",
      html: "<p>Hi {{ name }}</p>",
      reply_to: "support@acme.com",
      variables: { name: "Jane" },
      tags: [{ name: "category", value: "receipt" }],
      headers: { "X-Entity-Ref-ID": "order-123" },
      attachments: [{ filename: "invoice.pdf", content_type: "application/pdf", content: Buffer.from("%PDF-1").toString("base64") }],
    });
  });

  it("reads the body from standard input and prints JSON with --json", async () => {
    const accepted = { id: "msg_2", status: "scheduled", from: "a@acme.com", to: ["b@example.com"], environment: "test", scheduled_at: "2026-11-01T09:00:00Z" };
    const calls = mockFetch(() => json(202, accepted));
    const res = await cli(["send", "-f", "a@acme.com", "-t", "b@example.com", "-s", "Hi", "--text-file", "-", "--schedule", "2026-11-01T09:00:00Z", "--json"], {
      stdin: "From stdin",
    });
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), accepted);
    assert.equal(calls[0].body.to, "b@example.com");
    assert.equal(calls[0].body.text, "From stdin");
    assert.equal(calls[0].body.scheduled_at, "2026-11-01T09:00:00Z");
  });

  it("refuses --html with --html-file and a malformed --var", async () => {
    mockFetch();
    assert.equal((await cli(["send", "-f", "a@acme.com", "-t", "b@example.com", "--html", "x", "--html-file", "y"])).code, 2);
    assert.equal((await cli(["send", "-f", "a@acme.com", "-t", "b@example.com", "--var", "novalue"])).code, 2);
  });
});

describe("emails", () => {
  it("lists with filters as a table, with the next page", async () => {
    const calls = mockFetch(() =>
      json(200, page([{ id: "msg_1", status: "delivered", to: ["jane@example.com"], subject: "Hi", created_at: "2026-10-27T09:14:02Z" }], { total: 30, has_more: true })),
    );
    const res = await cli(["emails", "list", "--status", "delivered", "-q", "jane", "--days", "7", "--limit", "1", "--offset", "10"]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(calls[0].query, { status: "delivered", q: "jane", days: "7", limit: "1", offset: "10" });
    assert.match(res.stdout, /^ID +STATUS +TO +SUBJECT +CREATED\n/);
    assert.match(res.stdout, /msg_1 +delivered +jane@example\.com +Hi +2026-10-27 09:14/);
    assert.match(res.stdout, /11–11 of 30\. Next page: --offset 11/);
  });

  it("rejects a non-numeric --limit", async () => {
    mockFetch();
    assert.equal((await cli(["emails", "list", "--limit", "ten"])).code, 2);
  });

  it("gets and cancels by ID", async () => {
    const calls = mockFetch((c) =>
      json(200, {
        id: "msg_1",
        status: c.method === "POST" ? "canceled" : "delivered",
        from: "a@acme.com",
        to: ["b@example.com"],
        subject: "Hi",
        environment: "test",
        created_at: "2026-10-27T09:14:02Z",
        events: [{ event_type: "email.delivered", recipient: "b@example.com", occurred_at: "2026-10-27T09:14:05Z" }],
      }),
    );
    const got = await cli(["emails", "get", "msg_1"]);
    assert.match(got.stdout, /Status +delivered/);
    assert.match(got.stdout, /2026-10-27 09:14 +email\.delivered +b@example\.com/);
    const canceled = await cli(["emails", "cancel", "msg_1"]);
    assert.equal(canceled.stdout, "Canceled msg_1.\n");
    assert.equal(calls[1].path, "/v1/emails/msg_1/cancel");
  });
});

describe("domains", () => {
  const domain = {
    id: "dom_1",
    domain_name: "acme.com",
    status: "pending",
    dns_records: [{ type: "TXT", name: "postilon._domainkey.acme.com", value: "v=DKIM1", purpose: "dkim", status: "pending", required: true }],
    inbound_domain: "",
    created_at: "2026-10-27T09:00:00Z",
  };

  it("finds a domain by name across pages before verifying it", async () => {
    const calls = mockFetch((c) => {
      if (c.path === "/v1/domains" && c.query.offset === "0") return json(200, page([{ ...domain, id: "dom_0", domain_name: "other.com" }], { total: 2, has_more: true }));
      if (c.path === "/v1/domains") return json(200, page([domain]));
      return json(200, { domain, dns_verification: { mode: "pending_dns_propagation" } });
    });
    const res = await cli(["domains", "verify", "ACME.com"]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /v1/domains", "GET /v1/domains", "POST /v1/domains/dom_1/verify"]);
    assert.equal(calls[1].query.offset, "1");
    assert.match(res.stdout, /acme\.com is not verified yet/);
    assert.match(res.stdout, /TXT +postilon\._domainkey\.acme\.com +pending +v=DKIM1/);
  });

  it("says when no domain has that name", async () => {
    mockFetch(() => json(200, page([])));
    const res = await cli(["domains", "get", "nope.com"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /No domain named nope\.com/);
  });

  it("updates tracking and inbound by ID", async () => {
    const calls = mockFetch(() => json(200, domain));
    assert.equal((await cli(["domains", "update", "dom_1", "--open-tracking", "off", "--inbound-domain", ""])).code, 0);
    assert.equal(calls[0].method, "PATCH");
    assert.deepEqual(calls[0].body, { open_tracking_enabled: false, inbound_domain: "" });
    assert.equal((await cli(["domains", "update", "dom_1"])).code, 2);
    assert.equal((await cli(["domains", "update", "dom_1", "--click-tracking", "yes"])).code, 2);
  });
});

describe("inbound", () => {
  it("saves an attachment under its own name, without the path, and never over a file", async () => {
    const calls = mockFetch((c) =>
      c.path.endsWith("/attachments/0")
        ? new Response(new Uint8Array([1, 2, 3]))
        : json(200, { id: "inb_1", attachments: [{ filename: "../../evil.pdf", content_type: "application/pdf", size: 3 }] }),
    );
    const res = await cli(["inbound", "attachment", "inb_1", "0"]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual([...readFileSync(join(dir, "evil.pdf"))], [1, 2, 3]);
    assert.equal(calls[1].path, "/v1/inbound/inb_1/attachments/0");

    const again = await cli(["inbound", "attachment", "inb_1", "0"]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already exists/);

    assert.equal((await cli(["inbound", "attachment", "inb_1", "0", "-o", "evil.pdf"])).code, 0);
    assert.equal((await cli(["inbound", "attachment", "inb_1", "x"])).code, 2);
  });

  it("prints the raw message", async () => {
    mockFetch(() => new Response("Subject: Hi\r\n\r\nHello"));
    const res = await cli(["inbound", "raw", "inb_1"]);
    assert.equal(res.stdout, "Subject: Hi\r\n\r\nHello");
  });
});

describe("webhooks", () => {
  it("adds an endpoint with events and shows its signing secret", async () => {
    const calls = mockFetch(() =>
      json(201, { id: "wh_1", url: "https://acme.com/hook", description: "", signing_secret: "whsec_x", subscribed_events: ["email.bounced", "email.complained"], is_active: true, created_at: "2026-10-27T09:00:00Z" }),
    );
    const res = await cli(["webhooks", "add", "https://acme.com/hook", "--events", "email.bounced,email.complained"]);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(calls[0].body, { url: "https://acme.com/hook", subscribed_events: ["email.bounced", "email.complained"] });
    assert.match(res.stdout, /Signing secret +whsec_x/);
  });

  it("disables an endpoint and lists deliveries of one", async () => {
    const calls = mockFetch((c) => (c.path === "/v1/webhooks/deliveries" ? json(200, page([])) : json(200, { id: "wh_1", subscribed_events: [], is_active: false })));
    await cli(["webhooks", "update", "wh_1", "--disable"]);
    assert.deepEqual(calls[0].body, { is_active: false });
    const res = await cli(["webhooks", "deliveries", "--webhook", "wh_1"]);
    assert.equal(calls[1].query.webhook_id, "wh_1");
    assert.equal(res.stdout, "No deliveries.\n");
  });
});

describe("suppressions, API keys and credits", () => {
  it("removes a suppression by address", async () => {
    const calls = mockFetch((c) => (c.method === "GET" ? json(200, page([{ id: "sup_1", email_address: "jane@example.com" }])) : json(200, { deleted: true })));
    const res = await cli(["suppressions", "remove", "Jane@example.com"]);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(calls[1].method, "DELETE");
    assert.equal(calls[1].path, "/v1/suppressions/sup_1");
  });

  it("creates an API key and shows its token once", async () => {
    const calls = mockFetch(() => json(201, { api_key: { id: "key_1", name: "CI", environment: "test", scope: "sending_access" }, token: "ps_test_new" }));
    const res = await cli(["api-keys", "create", "CI", "--environment", "test", "--scope", "sending_access", "--expires-in-days", "30"]);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(calls[0].path, "/v1/api-keys");
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${KEY}`);
    assert.deepEqual(calls[0].body, { name: "CI", environment: "test", scope: "sending_access", expires_in_days: 30 });
    assert.match(res.stdout, /ps_test_new/);
    assert.equal((await cli(["api-keys", "create", "CI", "--scope", "everything"])).code, 2);
  });

  it("shows credits and turns API errors into a message", async () => {
    mockFetch(() => json(200, { credit_balance: 12345, next_expiry: null, live_sent_24h: 7 }));
    assert.match((await cli(["credits"])).stdout, /Balance +12,345 credits/);

    mockFetch(() => json(403, { error: { code: "insufficient_scope", message: "This key can only send email." } }));
    const res = await cli(["credits"]);
    assert.equal(res.code, 1);
    assert.equal(res.stderr, "Error: This key can only send email. (insufficient_scope, HTTP 403)\n");
  });
});
