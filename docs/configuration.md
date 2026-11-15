# Configuration and reference

**Your WhatsApp companion for T3 Code.**

From your existing WhatsApp account, type `@bot` followed by a message in a personal chat, group, or Message yourself. Reply to someone's issue to include its text as context. Mention projects and thread titles in ordinary language; T3 handles discovery and the requested action.

A local prototype built with Baileys and T3 Code's supported `t3 thread` CLI. Conversational answers and project/thread actions come from your T3 agent and use its configured provider allowance or API billing. Authentication, conversation delivery, and mapping commands use ordinary code without separate AI calls.

## One conversation per chat

The first message from each new personal chat or group starts a separate **No project** thread. Later messages in that chat continue its assistant conversation, including after a restart. Before continuing, the bridge checks T3’s `settled` flag. If the conversation is settled, it starts a fresh No project thread instead of reopening it. An ordinary completed agent turn does not reset the conversation. This is a remembered conversation, not a continuously running agent. General questions are answered in this conversation without creating work threads. Successful submissions produce no acknowledgement; WhatsApp receives the agent’s answer directly. Errors and approval notices are still surfaced when needed. Different chats do not share bridge conversation state.

Replying to an older bot response continues its conversation if it is unsettled and makes it active in the same chat again. If that conversation is settled, the reply starts a fresh No project thread instead. Ordinary messages and unprefixed replies to your own messages are ignored. Send exactly `@bot new` to clear the active conversation for this chat; the next message starts a fresh No project thread. Resetting does not interrupt work already started or erase the chat mapping.

The assistant uses T3's tools to discover projects, find threads by title, read relevant context, forward messages, or create threads when requested. There is no bridge thread selector, title regex, numbered selection menu, or thread configuration. If the requested destination is ambiguous, the agent can ask you to clarify.

```text
@bot hi
@bot add this to my todo thread in Diskovalist
@bot #website ask the Launch planning thread what remains to do
@bot create a research thread in the WhatsApp bot project
@bot what did you find?
@bot new
```

## Project context and mappings

Every assistant conversation starts and remains in No project, even when a hashtag or mapping is present. A `#project-name` adds project context to the prompt. Known aliases are resolved to paths or IDs from `config.json`; unknown names are passed to T3 for discovery. Your instruction stays intact. Quoted text cannot select a project hint.

An explicit hashtag takes precedence over the chat mapping for that message. Without a hashtag, the mapping is included as default context; without either, the agent receives only your request and conversation history. A hint is not a workspace switch or permission grant. Plain-language requests can name projects directly, without adding them to the bridge catalog.

| Command | Result |
| --- | --- |
| `@bot #website investigate this` | Send the instruction with the resolved website hint to this chat's No project conversation |
| `@bot use website for this chat` | Save a default project hint without resetting the conversation |
| `@bot unmap this chat` | Clear the default hint, including a configured fallback, without resetting the conversation |
| `@bot projects` | List configured hint aliases without an agent turn |
| `@bot new` | Reset this chat's conversation; retain its mapping |

Initial mappings live in private `config.json` under `routes`. Mappings saved by chat commands live in `.data/bridge.sqlite` and override the file entry. Restart after changing the configuration file. The `projects` catalog is optional shorthand for hints; it does not limit the projects the agent can discover through T3.

## Todos and results from other threads

Reply to an issue with `@bot #website add this to my todo thread`. The assistant finds the requested destination through T3 and follows that thread's established workflow. Saving an item does not ask the agent to implement it. There is no bridge todo parser or separate todo database.

The bridge relays responses from its No project assistant conversation. If you request a completed result from work in another thread, the prompt tells the assistant to follow T3's orchestration instructions to wait for and relay that result. If you only request creation or forwarding, it should confirm that action accurately. The bridge does not independently subscribe to every thread the agent mentions or promise automatic future updates. Permission requests still need an answer in T3 Code.

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
- `projects`: optional shorthand aliases mapped to registered T3 project paths or IDs. Define names such as `website` and `mobile-app`. Hashtags add these targets to the prompt; T3 can discover other projects by name.
- `noProject`: the registered T3 No project workspace path or ID used for every assistant conversation. Defaults to `~/.t3/scratch`; change it if your installation uses another location. The legacy `rememberContext` field is accepted for compatibility but ignored; per-chat continuity is always enabled.
- `routes`: optional initial chat mappings, for example `{"chatJid":"CHAT_ID","project":"PROJECT_PATH_OR_ID"}`. Account-wide mode does not require any routes. Saved `use ... for this chat` commands override configured mappings.
- `dataDir`: session and database directory, relative to the config file. Default `.data` matches pairing mode when run from this folder. For another pairing directory use `T3_WHATSAPP_DATA_DIR=/absolute/path pnpm pair`.

Keep config and session data private. They are gitignored. New assistant threads inherit the No project workspace's default model and permissions in T3 Code. T3 handles the settings for any project work the assistant starts.

```sh
pnpm run doctor
pnpm dev
```

Use `pnpm run doctor`: plain `pnpm doctor` runs pnpm's own diagnostics. The project check validates every catalog target without starting tasks. Set `T3_WHATSAPP_CONFIG=/absolute/path/config.json` to use another configuration file. Restart the bridge after editing config.

## First task

In any personal chat, group, or Message yourself, send `@bot hi`, or provide a project hint:

```text
@bot #website Explain this project briefly. Don't change any files.
```

Or reply to an issue message with `@bot #website resolve this`. Bot messages begin with `[T3 Bot]`, because commands and replies use your number. Reply to a bot response to continue that conversation; no new `@bot` prefix is required for replies to bot updates. Ordinary conversations and unprefixed replies to your own instructions are ignored.

Only new commands sent after the bridge starts are accepted. Commands received after a temporary disconnection may be recovered within the configured age window while the same process is alive. Accepted conversation messages and replies are durable. Outgoing bot IDs are recorded before sending and rejected as commands, including after restart, to prevent reply loops.

Keep the Mac awake, online, and T3 Code running. This version runs in the foreground. If T3 asks a question or needs permission, answer in T3 Code; typing “yes” in WhatsApp never approves a permission prompt.

## Restricted or separate-account mode

Set `accountWide: false` to restrict the bridge to chats listed in `routes`. With `selfCommands: false`, use a separate personal sender and bot number, allowlist your personal sender IDs, and select the bot contact from the mention picker for new tasks. Plain typed `@bot` is insufficient in that mode.

Old configs containing `routes[].groupJid` are read as `chatJid` mappings. If `projects` is absent, simple aliases are derived from route project folder names. New configurations can define hint aliases explicitly or leave the catalog empty.

## Recovery and privacy

Only one bridge instance may use a data directory. Stop `pnpm pair` before starting `pnpm dev`. Normal shutdown releases `.data/run.lock`. If the process crashed, confirm the PID in that file has stopped before removing the lock.

Ambiguous T3 submissions and WhatsApp sends are held for review rather than automatically repeated, because the external operation may already have succeeded. Changing hint aliases or mappings does not move or discard a conversation. Removing a chat from restricted-mode routes blocks its persisted work and replies. Changing the No project workspace holds work tied to the previous workspace for review.

If an existing T3 thread advances to another run in the desktop app, the bot asks you to review there rather than sending an unrelated answer. Long results are split and capped; the full result remains in T3 Code. Shutdown stops further submissions and waits up to ten seconds for in-flight bridge operations and credential writes. Unfinished side effects require review on restart.

`.data/bridge.sqlite` stores accepted requests, quoted context, project hints, chat mappings, active conversations, and replies in plaintext with no automatic retention cleanup yet. `.data/auth` contains WhatsApp session credentials. Never upload either. Baileys logging is silenced, and connection diagnostics contain only lifecycle information, protocol version, allowlisted error reasons, and command acceptance flags.

New files are restricted to your Mac user. The prototype uses Baileys's multi-file auth helper; a transactional auth store is future work. The bridge does not read or modify T3's internal database. Instructions and quoted context submitted to an agent also reach its configured AI provider.

### Upgrading from native project/thread selection

Older bot conversations remain in T3 history, but new commands start a fresh No project conversation rather than resuming an old project-bound or selector-managed thread. Legacy queued requests are held for review instead of replayed under changed semantics. Old project/thread choice prompts are superseded. Existing message IDs are retained to prevent duplicates and echo loops. Old unused database tables are left intact; new conversations do not use them. Resend any request that was waiting on an old selector prompt as a fresh `@bot` message.

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

`pnpm start` runs the built application. Type checking covers both source and tests. Tests cover account-wide authorization, separate No project conversations per chat, prompt hints, conversation memory, mappings, task continuity, migration, reply loops, pairing isolation, shutdown, recovery, Unicode, and CLI validation. Automated tests use synthetic messages and a fake T3 adapter; they do not prove live delivery in every WhatsApp client.

Text tasks only. Attachments, voice transcription, remote permission approvals, private cross-chat result routing, and a macOS background service are not implemented. Project/thread discovery and work delegation depend on the T3 tools available to the chosen agent. There is no bridge configuration for worktrees or subscriptions to other threads. Mapping commands use no extra AI calls.

## Contributing and references

Follow [CONTRIBUTING.md](../CONTRIBUTING.md). Commits use `<type>: <short description>`.

- [Baileys](https://github.com/WhiskeySockets/Baileys), pinned to `7.0.0-rc14`.
- [T3 host scripting documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md).
- Related work: [Toucan Router](https://github.com/salalaslam/toucan-router). Its documentation informed the integration comparison; this is a separate implementation. No Toucan code or credentials are bundled.

Dependency policy: prefer stable releases and commit the lockfile. Baileys remains an explicit exception: the stable 6.7.24 line requires a transitive Git dependency blocked by pnpm's default policy, so the current release candidate is retained without disabling those checks.
