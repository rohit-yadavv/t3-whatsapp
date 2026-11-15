# T3 WhatsApp Bot

**Your WhatsApp companion for T3 Code.**

Use your existing WhatsApp number: type `@bot` followed by a task in a configured group to start work. Quote a message to include its text as context. Reply to the bot’s acknowledgement or result to continue the same T3 thread.

Early local prototype, built for a personal Mac workflow. Uses Baileys for WhatsApp and T3 Code’s supported local `t3 thread` CLI. No separate model is used to route or format messages.

## What works in this version

- Explicit single-account `@bot` commands, plus optional separate-account real contact mentions.
- Explicit group-to-project routes and sender allowlists, including WhatsApp LID aliases.
- A separate T3 thread for a fresh task; follow-ups reuse the original thread.
- Quoted text context, acknowledgements, and the final assistant response back to WhatsApp.
- SQLite task mappings and an outbox survive restarts.
- Duplicate incoming messages are ignored; historical, stale, generated bot replies, and unauthorized messages do not start tasks.
- T3 permission/input requests direct you to the T3 app. The bridge never approves prompts.

Text only for now. Attachments and quoted attachments are explicitly rejected; voice transcription, remote approvals, `/status` commands, worktree selection, and installation as a macOS service are future work. A follow-up waits until its preceding WhatsApp request finishes. If the thread advances to a different run in the desktop app, the bridge asks you to review there rather than sending a potentially unrelated answer.

## Requirements

- Node.js 22.13+ (uses built-in `node:sqlite`) and pnpm 12.21.0.
- T3 Code running locally, with `t3 thread` support and the target projects already registered.
- A paired WhatsApp account in your chosen group. With `selfCommands: true`, use that same account to type `@bot` commands. A separate bot number is optional.

Baileys uses WhatsApp’s linked-device protocol without official Meta support; account restrictions and protocol changes are possible. A dedicated number limits account exposure, although single-account mode is supported. The local bridge adds no AI calls, but tasks still consume the provider allowance or API billing configured in T3 Code.

## Setup

From this folder:

```sh
pnpm install --frozen-lockfile
pnpm pair
```

Pairing mode opens a full-size black-on-white QR image in Preview on macOS. Scan that image rather than the small terminal blocks. It is also saved locally at `.data/pairing-qr.png` and refreshed when WhatsApp issues another QR. Keep pairing mode running and use the newest QR. The image is deleted on successful pairing or normal shutdown.

Scan the QR **locally** from the bot account’s WhatsApp → Linked devices. The QR grants account access; keep it private. Pairing mode does not start T3 tasks or send messages. It prints joined group IDs. For single-account mode, use the printed bot identifiers as your allowed sender IDs. In separate-account mode, send a message from your personal account in the intended group while pairing mode runs to print its sender identifiers. These setup identifiers stay in the terminal.

Press Ctrl+C. Then:

```sh
cp config.example.json config.json
```

Edit `config.json`:

- `t3Binary`: the absolute CLI path. Use `t3` if it is on your PATH, or set an absolute path such as `/Users/your-name/.t3/bin/t3`.
- `selfCommands`: `true` for your existing account with typed `@bot` commands; `false` for a separate bot account using real contact mentions.
- `allowedSenderJids`: in single-account mode, use the paired account identifiers. In separate-account mode, use your personal sender identifiers. Remove all example entries.
- `routes`: the group ID and the registered T3 project path or ID. One route per group.
- `dataDir`: session and database directory, relative to the config file. Default `.data` matches pairing mode when run from this folder. For a custom pairing directory use `T3_WHATSAPP_DATA_DIR=/absolute/path pnpm pair`.

Keep config and session data private. They are gitignored. The process restricts new files to your user. Start with a project whose default T3 permissions and model you are comfortable using from WhatsApp; the bridge inherits those defaults.

```sh
pnpm run doctor
pnpm dev
```

`pnpm run doctor` validates config (plain `pnpm doctor` runs pnpm’s own diagnostics) and reads the configured T3 projects without creating tasks. For another config file, set `T3_WHATSAPP_CONFIG=/absolute/path/config.json`.

## Try the flow

With `selfCommands: true` (the example configuration):

1. From the paired account, type `@bot Explain this project briefly. Don’t change any files.` in the configured group. No contact mention selection is needed.
2. You can also quote a text bug report and type `@bot investigate this`.
3. Replies are marked `[T3 Bot]` because both your instructions and the automated replies come from your number.
4. Reply to an acknowledgement or result to continue its thread. A new `@bot` prefix is optional for replies to bot output. Ordinary conversations and unprefixed replies to your own instructions are ignored.

Single-account mode only accepts your authenticated own-account messages in configured groups. Other group participants cannot start work, even by typing `@bot`. Generated outgoing IDs are stored before sending and rejected as incoming commands, including after a restart, to prevent reply loops. New self-commands from before the bridge starts are not replayed: send a fresh command after it connects. Disconnected commands may be recovered within the configured age window while the same process is alive.

With `selfCommands: false`, use a separate personal sender and bot number. Select the bot from the contact mention picker for new tasks. Plain typed `@bot` is not sufficient in that mode.

If a task stops for a T3 question or approval, answer in T3 Code; sending “yes” in WhatsApp never approves permission prompts.

Keep the Mac awake, online, and T3 Code running. This version is a foreground process.

### If WhatsApp says “Couldn't link device”

Restart `pnpm pair` and scan the newest full-size QR image in Preview. If the camera does not recognize the terminal QR, open the image with `open .data/pairing-qr.png` from another terminal while pairing keeps running. The bridge fetches the current WhatsApp Web protocol version once at startup, retains it for reconnects, and handles the normal post-pairing restart (515) after saving credentials. It falls back to the bundled version if the public lookup is unavailable.

Connection and command-decision diagnostics are printed and written to `.data/connection.ndjson`. They contain only timestamps, lifecycle events, protocol version, disconnect codes, allowlisted stream-error labels, and command acceptance flags—no QR, session secrets or message content. A fresh scan is still needed to verify a pairing fix. If linking fails again, use those status lines to diagnose it; do not share the QR or files inside `.data/auth`. Existing credentials are never deleted automatically.

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm start
```

Automated tests cover authorization, own-message loop prevention, quoted context, follow-ups, pairing isolation, shutdown, project-route changes, crash-safe attachment rejection, repeated approval notices, Unicode, CLI validation/timeouts, and startup lock cleanup. `pnpm check` type-checks both source and tests. They use a fake T3 adapter and synthetic WhatsApp messages; they do not prove a live account pairing or end-to-end WhatsApp delivery.

## Recovery and privacy

Only one bridge instance may use a data directory. If it crashed and left `.data/run.lock`, inspect its PID and confirm the old process has stopped before deleting that lock. Normal Ctrl+C removes it. Pairing mode never processes saved tasks or replies. Shutdown stops further submissions and waits up to ten seconds for in-flight bridge operations and credential writes; unfinished side effects require review on restart.

An interrupted or ambiguous T3 submission is marked `review` in SQLite and is **not automatically retried**, because the task may already exist. An ambiguous outgoing send is likewise held in the outbox. Inspect T3/WhatsApp before manually retrying. Queued work and confirmed running tasks resume on restart; results pending in the outbox are sent when connected. Changing/removing a group’s project route holds its old tasks and replies for review, so they cannot run or leak results into the new route. This is conservative recovery, not a guarantee of exactly-once delivery.

`.data/bridge.sqlite` stores accepted instructions, quoted context, mappings, and responses in plaintext; `.data/auth` contains WhatsApp credentials. Do not upload either. There is no automatic retention cleanup yet. Baileys logging is silenced so it cannot dump raw group messages to the terminal. Pairing mode deliberately prints identifiers needed for setup.

Baileys’s multi-file auth helper is used for this single-user prototype. It should be replaced with a transactional auth store before larger deployments. The bridge does not read or modify T3’s internal database.

## Design and references

- WhatsApp transport: [Baileys](https://github.com/WhiskeySockets/Baileys), pinned to `7.0.0-rc14` in the lockfile.
- T3 integration: [`t3 thread` host scripting documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md).
- Related work: [Toucan Router](https://github.com/salalaslam/toucan-router). Its WhatsApp and T3 setup documentation informed the comparison; this is a separate implementation focused on WhatsApp mentions and reply-to-thread continuity.

The WhatsApp transport, routing/store, and T3 adapter are separate modules so the integration can evolve without rewriting task routing. No code or credentials from Toucan are bundled.

Dependency policy: prefer current stable releases and commit the lockfile. Baileys is an explicit exception: its latest published release is `7.0.0-rc14`; the stable 6.7.24 line requires a transitive Git dependency rejected by pnpm’s default security policy. We currently retain rc14 without disabling that policy. Revisit when a compatible stable release is available.

Connection recovery: a known Baileys `Stream Errored (ack)` with code 500 retries up to three times in a short-lived failure sequence. A connection healthy for at least one minute resets that retry budget. Unknown/bad-session 500s and explicit logout/restriction codes stop without deleting credentials.
