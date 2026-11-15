# Set up T3 WhatsApp

Use this guide when installing or configuring the bot, including when helping a user from T3 Code. Setup runs locally; it is not a hosted service.

## Prerequisites

- Node.js 22.13+ and pnpm 12.21.0.
- T3 Code running locally with `t3 thread` support.
- Your phone with WhatsApp → Linked devices available.

From a checkout of this repository:

```sh
pnpm install --frozen-lockfile
pnpm setup
```

Setup opens a local browser page. If a browser cannot be opened automatically, open the printed URL on the same computer. Windows users should open that URL manually. `pnpm setup --no-open` suppresses automatic opening.

1. **Check T3.** Setup detects the standard `~/.t3/bin/t3` installation when present; otherwise it uses `t3` on PATH. You can enter a different executable path. It verifies the No project workspace and any existing configured project hints with read-only `t3 thread list` calls. It does not start T3 or create workspaces.
2. **Link WhatsApp.** Click **Link or verify account**. Scan the live QR with your phone. If a saved session is still valid, it reconnects without a QR. Linking finishes and stops automatically after credentials are saved. It does not start tasks, import chat history, or send replies.
3. **Choose preferences.** New installations default to **Message yourself only** and **history off**. Choose explicitly before saving. Account-wide access includes supported personal chats and groups; only your own paired account can issue commands. Replies are visible to chat members. Enabling history captures ordinary text in enabled chats, too; relevant text can reach the AI provider configured in T3.
4. **Save and try.** Save configuration, then start the bridge. Send `@bot hi` in Message yourself, or in an enabled chat for an existing restricted installation. The page reports connection, command acceptance, and reply-send events; confirm the reply actually arrives on your phone.

The setup page uses an unguessable access token in the URL fragment. Keep the complete URL and QR private; do not paste them into issues, chat transcripts, or diagnostic reports. No token or credential is stored in browser storage. Reloading the page removes access; reopen the original complete terminal URL.

## Running after setup

The setup process owns the bridge it starts. Closing its browser tab is fine. Ctrl+C in the setup terminal stops both setup and its bridge, preserving the paired session. To run independently later:

```sh
pnpm dev
```

Or build and run:

```sh
pnpm build
pnpm start
```

Keep the computer awake, connected, and T3 running. This first setup release does not install a background service, publish a package, or change login items. For a built checkout, `node dist/setup-cli.js` opens setup without the TypeScript runner.

## Agent-assisted setup

A request such as “Set up T3 WhatsApp in this checkout” should use the same flow. Read the [setup skill](skills/t3-whatsapp-setup/SKILL.md) for the operational constraints.

Inspect without opening WhatsApp or writing configuration:

```sh
pnpm doctor --json
pnpm config:show --json
```

`doctor` exits with status 1 when something needs attention and still emits a JSON report. A missing configuration is supported. `config:show` reports effective setup preferences and local paths, excluding account identifiers and session credentials; it does not dump advanced configuration. An invalid existing configuration is reported, not overwritten.

Check codes include `t3_ready`, `t3_unavailable`, `needs_pairing`, `session_saved`, `session_invalid`, `account_mismatch`, `runtime_idle`, `runtime_locked`, and `setup_invalid`. `session_saved` means credentials exist, not that WhatsApp is connected. Reports always set `whatsappLiveVerified: false`; use the setup page for live verification.

Run `pnpm setup` in a terminal the user can keep open. The user scans the QR and chooses access/history preferences on the page. Never print authentication files, QR payloads, or full setup URLs into an agent answer. Do not select all-chat access or enable history without the user's preference. Do not send a WhatsApp test message through another tool; let the user send the first command.

## Existing installations and recovery

Setup respects `T3_WHATSAPP_CONFIG` (default `config.json`). For a new configuration, `T3_WHATSAPP_DATA_DIR` can select the data directory; otherwise `.data` is next to the configuration. Existing configuration always determines its data directory. Configuration writes are private and atomic. Existing aliases, runtime databases, session files, and advanced settings are preserved. Access settings stay unchanged unless the user selects a different access mode. Switching to Message yourself replaces configured chat routes with self-chat routes; saved mapping records remain in SQLite.

Stop an existing bridge or pairing process before linking or saving. Setup never stops an unrelated PID. A second setup process is refused via `setup.lock`. If a crash leaves `run.lock` or `setup.lock`, verify its recorded PID has exited before removing only that lock. Do not remove `.data`, reset databases, log out, or re-pair automatically to repair a lock or a transient connection failure.

If configuration changes outside the page, restart setup to load it. A different paired owner or a changed No project workspace needs deliberate review; setup refuses to replace existing authorization or move conversations. Ambiguous task submissions and sends retain the runtime's existing review behavior and are not replayed by setup.

If T3 cannot be reached, open T3 and check the executable and workspace values. If a saved WhatsApp session has expired, use linking to show a new QR. Read local lifecycle diagnostics in `.data/connection.ndjson` when necessary; do not share credentials, QR images, message databases, or raw logs in public reports.

Project mapping is optional and can be managed after setup with the existing WhatsApp commands. See [configuration and mappings](docs/configuration.md#project-context-and-mappings). This setup release validates existing projects; it does not maintain a second project discovery system.
