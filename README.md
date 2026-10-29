# @postilon/cli

Send email and manage your [Postilon](https://postilon.com) account from the terminal: domains, sent and received email, webhooks, templates, suppressions, API keys and credits. Needs Node.js 18.3 or later. Built on [`@postilon/node`](https://www.npmjs.com/package/@postilon/node).

Full documentation: [postilon.com/docs/cli](https://postilon.com/docs/cli).

## Install

```bash
npm install -g @postilon/cli
```

Or run it once with `npx @postilon/cli <command>`.

## Sign in

```bash
postilon login
```

Paste an API key from the dashboard (**API Keys**). The CLI checks the key, then saves it to `~/.config/postilon/config.json` (or `$XDG_CONFIG_HOME/postilon/config.json`) with permissions that let only you read it. You can also pipe the key in: `echo "$KEY" | postilon login`.

`POSTILON_API_KEY` takes precedence over the saved key, which suits CI. `postilon whoami` shows the key in use, and `postilon logout` deletes the saved one. `POSTILON_API_URL` (or `postilon login --api-url`) points the CLI at another API, such as a local server.

Use a `ps_test_…` key to try things out. Test emails are accepted and reported but never delivered, and they use no credits.

## Send an email

```bash
postilon send -f "Acme <hello@acme.com>" -t jane@example.com -s "Hello" --text "Hi Jane"

postilon send -f billing@acme.com -t jane@example.com -s "Receipt" \
  --html-file receipt.html --attach invoice.pdf --tag category=receipt

postilon send -f hello@acme.com -t jane@example.com --template tmpl_welcome --var name=Jane
```

`send` also takes `--cc`, `--bcc`, `--reply-to`, `--header "Name: value"`, `--schedule <RFC 3339 time>` and `--idempotency-key`. Repeat `--to`, `--var`, `--tag` and `--attach` to give more than one, or list recipients with commas.

## Commands

| Command | Subcommands |
| --- | --- |
| `login`, `logout`, `whoami` | Save, remove and show the API key |
| `send` | Send an email |
| `emails` | `list`, `get <id>`, `cancel <id>` |
| `domains` | `list`, `get`, `add <name>`, `verify`, `update`, `remove` (take a name such as `acme.com` or a `dom_…` ID) |
| `inbound` | `list`, `get <id>`, `raw <id>`, `attachment <id> <index>` |
| `webhooks` | `list`, `get`, `add <url>`, `update`, `remove`, `test`, `events`, `deliveries`, `replay <delivery-id>` |
| `templates` | `list`, `get`, `create <name>`, `update`, `remove` |
| `suppressions` | `list`, `add <address>`, `remove <address>` |
| `api-keys` | `list`, `create <name>`, `revoke <id>`, `remove <id>` |
| `credits` | Show the credit balance |

`postilon <command> --help` lists each command's options.

## Scripts

`--json` prints the API's response instead of a table. The CLI exits with `0` on success, `1` on an API or network error (printed to standard error with the API's error code), and `2` on a wrong command line.

```bash
postilon emails list --status bounced --days 1 --json | jq -r '.data[].to[]'
```

## Development

```bash
npm install
npm run build
npm test
```

The tests run the built CLI against a fake `fetch`, so they need no network access and no API key.

## License

MIT, see [LICENSE](./LICENSE).
