# T3 WhatsApp Bot

**Your WhatsApp companion for T3 Code.**

From your existing WhatsApp account, type `@bot #project-name` followed by a task in a personal chat, group, or Message yourself. Reply to someone's issue to include its text as context. Replies to bot updates continue the same T3 thread.

A local prototype built with Baileys and T3 Code's supported `t3 thread` CLI. Routing, project selection, and chat commands use ordinary code without separate AI calls. Agent tasks consume the provider allowance or API billing configured in T3 Code.

## Project selection

For a new task:

1. An explicit `#project-name` selects the project for that task.
2. Otherwise, use the chat's saved mapping.
3. If neither exists, ask which project before doing work. There is no global default and no AI guessing.

A project hashtag never changes the saved mapping. Project names match the aliases in `config.json`, case-insensitively. Put the selector immediately after `@bot`; a known alias also works elsewhere in the instruction. Unknown leading names and conflicting selectors ask for a choice instead of falling back to a mapping. Quoted issue text never controls project selection.

| Command | Result |
| --- | --- |
| `@bot #website fix this` | New task in `website`, without changing the chat mapping |
| `@bot use website for this chat` | Save the chat's project mapping |
| `@bot fix this` | Use the saved mapping, or ask which project |
| `@bot projects` | List configured project names; no agent task |
| `@bot unmap this chat` | Clear the chat mapping, including a configured fallback |

When asked which project, reply to that bot message with `#website`. The bot resumes your original instruction and quoted issue; you do not need to repeat them. Choosing a project this way does not save a permanent chat mapping. Reply `cancel` to discard a pending task. Invalid choices can be corrected by replying to the latest bot prompt. Choices and chat mappings survive restarts.

Replies to existing bot task updates keep their original project, even if the chat's mapping changes. If your reply specifies another project, the bot asks whether to create a **new** task. Reply `new` to confirm or `cancel` to leave the original thread alone. A thread's project is never silently switched.

**Responses are posted in the chat where you sent the command.** Everyone in that chat can see them. Use Message yourself when the task or result should stay private.

## Requirements

- Node.js 22.13+ and pnpm 12.21.0.
- T3 Code running locally with `t3 thread` support and your target projects registered.
- A paired WhatsApp account. In account-wide mode, only messages from your own authenticated account can issue commands. Other participants cannot trigger work by typing `@bot`.

Baileys uses WhatsApp's linked-device protocol without official Meta support. Account restrictions and protocol changes are possible. A dedicated number limits exposure, although using your existing account is supported.

## Setup

```sh
pnpm install --frozen-lockfile
pnpm pair
```

Pairing mode opens a full-size black-on-white QR image in Preview on macOS. Scan that image from WhatsApp → Linked devices, rather than the small terminal blocks. The image is also saved at `.data/pairing-qr.png` and refreshed when WhatsApp issues a new QR. Keep pairing running and use the newest image. It is removed after pairing or normal shutdown.

The QR grants account access: keep it private. Pairing mode never starts T3 tasks or sends saved replies. It prints the paired account identifiers and joined group IDs locally. For separate-account setup, messages sent by your personal account in a group also print its sender identifiers.

Press Ctrl+C, then create your private configuration:

```sh
cp config.example.json config.json
```

Edit these fields:

- `t3Binary`: `t3` if it is on your PATH, or an absolute path such as `/Users/your-name/.t3/bin/t3`.
- `selfCommands`: `true` for typed `@bot` commands from the paired account.
- `accountWide`: `true` to accept your own commands in personal chats, groups, and Message yourself. This requires `selfCommands: true`. Status broadcasts and channels are excluded.
- `allowedSenderJids`: the paired account identifiers printed during pairing. Remove all example values. At least one must match the connected account.
- `projects`: project aliases mapped to registered T3 project paths or IDs. Define names such as `website` and `mobile-app`. The catalog is explicit; it does not automatically discover newly added T3 projects.
- `routes`: optional initial chat mappings, for example `{"chatJid":"CHAT_ID","project":"PROJECT_PATH_OR_ID"}`. Account-wide mode does not require any routes. Saved `use ... for this chat` commands override configured mappings.
- `dataDir`: session and database directory, relative to the config file. Default `.data` matches pairing mode when run from this folder. For another pairing directory use `T3_WHATSAPP_DATA_DIR=/absolute/path pnpm pair`.

Keep config and session data private. They are gitignored. The bridge inherits each target project's default model and permissions in T3 Code.

```sh
pnpm run doctor
pnpm dev
```

Use `pnpm run doctor`: plain `pnpm doctor` runs pnpm's own diagnostics. The project check validates every catalog target without starting tasks. Set `T3_WHATSAPP_CONFIG=/absolute/path/config.json` to use another configuration file. Restart the bridge after editing config.

## First task

In any personal chat, group, or Message yourself, send:

```text
@bot #website Explain this project briefly. Don't change any files.
```

Or reply to an issue message with `@bot #website resolve this`. Bot messages begin with `[T3 Bot]`, because commands and replies use your number. Reply to an acknowledgement or result to continue that task; no new `@bot` prefix is required for replies to bot updates. Ordinary conversations and unprefixed replies to your own instructions are ignored.

Only new commands sent after the bridge starts are accepted. Commands received after a temporary disconnection may be recovered within the configured age window while the same process is alive. Existing queued work and pending choices are durable. Outgoing bot IDs are recorded before sending and rejected as commands, including after restart, to prevent reply loops.

Keep the Mac awake, online, and T3 Code running. This version runs in the foreground. If T3 asks a question or needs permission, answer in T3 Code; typing “yes” in WhatsApp never approves a permission prompt.

## Restricted or separate-account mode

Set `accountWide: false` to restrict the bridge to chats listed in `routes`. With `selfCommands: false`, use a separate personal sender and bot number, allowlist your personal sender IDs, and select the bot contact from the mention picker for new tasks. Plain typed `@bot` is insufficient in that mode.

Old configs containing `routes[].groupJid` are read as `chatJid` mappings. If `projects` is absent, simple aliases are derived from route project folder names. New configurations should define the catalog explicitly.

## Recovery and privacy

Only one bridge instance may use a data directory. Stop `pnpm pair` before starting `pnpm dev`. Normal shutdown releases `.data/run.lock`. If the process crashed, confirm the PID in that file has stopped before removing the lock.

Ambiguous T3 submissions and WhatsApp sends are held for review rather than automatically repeated, because the external operation may already have succeeded. Removing a project from the catalog holds its persisted work and replies for review. Chat mapping changes affect new tasks; existing threads retain their original project. Restricted-mode configured route changes retain conservative recovery for old work.

If an existing T3 thread advances to another run in the desktop app, the bot asks you to review there rather than sending an unrelated answer. Long results are split and capped; the full result remains in T3 Code. Shutdown stops further submissions and waits up to ten seconds for in-flight bridge operations and credential writes. Unfinished side effects require review on restart.

`.data/bridge.sqlite` stores accepted requests, quoted context, mappings, project-choice prompts, and replies in plaintext with no automatic retention cleanup yet. `.data/auth` contains WhatsApp session credentials. Never upload either. Baileys logging is silenced, and connection diagnostics contain only lifecycle information, protocol version, allowlisted error reasons, and command acceptance flags.

New files are restricted to your Mac user. The prototype uses Baileys's multi-file auth helper; a transactional auth store is future work. The bridge does not read or modify T3's internal database. Instructions and quoted context submitted to an agent also reach its configured AI provider.

### Linking or connection problems

If the camera cannot recognize the terminal QR, use the full-size image. While pairing runs, open it with `open .data/pairing-qr.png` from another terminal if necessary.

The bridge fetches WhatsApp Web's current protocol version at startup, retains it across reconnects, and falls back to the bundled version if lookup fails. The normal post-pairing restart (515) waits for credentials to be saved. Known `Stream Errored (ack)` failures with code 500 receive bounded retries; a healthy connection lasting at least one minute resets that budget. Unknown bad-session errors, logout, and restriction codes stop without deleting credentials.

See `.data/connection.ndjson` for diagnostics. Do not share QR images or auth files.

## Verification and current limits

```sh
pnpm check
pnpm test
pnpm build
```

`pnpm start` runs the built application. Type checking covers both source and tests. Tests cover account-wide authorization, project selection, durable choices, mappings, task continuity, reply loops, pairing isolation, shutdown, recovery, Unicode, and CLI validation. Automated tests use synthetic messages and a fake T3 adapter; they do not prove live delivery in every WhatsApp client.

Text tasks only. Attachments, voice transcription, remote permission approvals, worktree selection, private cross-chat result routing, automatic project discovery, and a macOS background service are not implemented. Project choices and mapping commands use no extra AI calls.

## Contributing and references

Follow [CONTRIBUTING.md](CONTRIBUTING.md). Commits use `<type>: <short description>`.

- [Baileys](https://github.com/WhiskeySockets/Baileys), pinned to `7.0.0-rc14`.
- [T3 host scripting documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md).
- Related work: [Toucan Router](https://github.com/salalaslam/toucan-router). Its documentation informed the integration comparison; this is a separate implementation. No Toucan code or credentials are bundled.

Dependency policy: prefer stable releases and commit the lockfile. Baileys remains an explicit exception: the stable 6.7.24 line requires a transitive Git dependency blocked by pnpm's default policy, so the current release candidate is retained without disabling those checks.
