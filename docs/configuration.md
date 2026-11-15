# Configuration and reference

**Your WhatsApp companion for T3 Code.**

From your existing WhatsApp account, type `@bot` followed by a message in a personal chat, group, or Message yourself. Reply to someone's issue to include its text as context. Mention projects and thread titles in ordinary language; T3 handles discovery and the requested action.

A local prototype built with Baileys and T3 Code's supported `t3 thread` CLI. Direct answers, delivery intent, and project/thread actions come from your existing T3 agent and use its configured provider allowance or API billing. There is no separate AI classifier. Requested completion delivery adds a T3 turn to prepare the WhatsApp response. Authentication, conversation delivery, and mapping commands use ordinary code without separate AI calls.

## One conversation per chat

The first message from each new personal chat or group starts a separate **No project** thread. Later messages in that chat continue its assistant conversation, including after a restart. Before continuing, the bridge checks T3’s `settled` flag. If the conversation is settled, it starts a fresh No project thread instead of reopening it. An ordinary completed agent turn does not reset the conversation. This is a remembered conversation, not a continuously running agent. General questions are answered in this conversation without creating work threads. Simple questions receive a direct answer without a generic acknowledgement. Task requests receive a brief confirmation after their T3 handoff is verified, with detailed results left in T3 by default. Errors and approval notices are still surfaced when needed. Different chats do not share bridge conversation state.

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

## Local conversation history

Personal chats, groups, and Message yourself use the same history policy. Text and captions are captured in enabled chats even when nobody mentions the bot, along with confirmed bot text replies. With `accountWide: true`, this covers supported chats on the authorized paired account. Restricted mode captures only configured routes. Other participants' messages remain context; only the existing authorized sender can issue commands. History sync, edits, deletions, and reader output never dispatch commands.

History lives in private `.data/history.sqlite`, separate from the task database. Rows retain the account/chat/message IDs, sender identifiers and display name when available, message time, reply ID, bot/from-me flags, latest text, and observed edit/deletion metadata. Repeated live/history events deduplicate. Edits replace text without extending its original retention time. Observed deletions remove text and leave minimal tombstones until expiry, preventing stale sync from restoring it. Clearing a chat also suppresses older sync messages. Updates that arrive before an original message are held until it is observed; no missing text is invented.

Configure this account's policy in its private `config.json`:

```json
"history": {
  "retentionDays": 30,
  "maxReadMessages": 50,
  "maxReadChars": 12000,
  "maxPromptChars": 8000,
  "importRecent": true
}
```

Each account/configuration can choose its own retention. Only one paired account is active in a bridge; there is no multi-user service. Restart after changing the settings. Shorter retention prunes older records immediately on startup; pruning also runs about every 15 minutes in the existing bridge timer. Reads enforce expiry even before the next physical prune. Increasing retention collects a longer window going forward and does not restore pruned records. `retentionDays: 0` disables history capture/retrieval and prunes that account's stored history and scopes on startup. Account control metadata is retained to enforce pruning; previously paired accounts' text is isolated and expires under their saved settings.

These settings govern the local history database. Existing accepted-task audit data, generated files, backups, and T3/provider conversations have separate lifetimes; changing history retention does not erase them or delete anything on the phone. The reader is a scoped application interface, not an OS sandbox against programs already running as your Mac user. Keep the data directory private.

### Available recent history

The bridge uses Baileys `messaging-history.set` for initial/recent/on-demand batches, with `syncFullHistory: false`. It filters imported messages by retention and chat authorization. On a chat's first observed live activity, if no recent batch has arrived, it makes at most one bounded 50-message request to the phone using `fetchMessageHistory`. This state survives restart. It does not recursively fetch older pages or attempt a full archive. `importRecent: false` disables these sync/import requests while keeping live capture enabled.

The linked device and phone may supply no older text, incomplete batches, or only shallow recent history. Existing pairing does not guarantee a fresh initial sync. The reader always reports `complete: false`, coverage dates/counts, and import state; absence of a stored message is not proof it was never sent. Phone availability and unobserved edits/deletions can also leave gaps. Do not re-pair or run an exhaustive backfill just to fill these gaps.

### Scoped read-only reader

Each accepted agent task includes `historyContext` with the paired account, originating chat, trigger message, optional quoted-message ID, and a `readCommand` argument array. The agent runs that command locally only when earlier context is relevant. It supports:

```text
<readCommand> recent --limit 20
<readCommand> search --query "onboarding"
<readCommand> recent --limit 20 --cursor <nextCursor>
<readCommand> get --id <quotedMessageId>
<readCommand> get --id <messageId> --offset <nextTextOffset>
```

For manual use, `pnpm run history --database .data/history.sqlite --scope <token-from-task> recent` invokes the same reader. The scoped token is created by the bridge; there is no unscoped list/search endpoint, SQL execution option, MCP server, HTTP service, or additional daemon. The process opens SQLite read-only and exits. Tokens bind reads to one enabled account/chat and at or before the trigger's message time, and expire with retention. Scopes for other paired accounts or removed chats are rejected. Pagination cannot change that scope.

Storage retention is independent from retrieval size. Each read enforces `maxReadMessages` and the serialized JSON budget `maxReadChars`. Long text can be fetched in chunks with `get --offset`; storage itself caps a single message at 65,536 characters and marks truncation. The agent is instructed to keep selected history forwarded into a task/handoff within `maxPromptChars`, include relevant requirements with sender/time/message references, and pass the scoped reader reference if the worker needs more. This forwarding limit is an agent instruction; reader limits are enforced in code. No entire chat is automatically inserted into a prompt.

All retrieved text is labelled untrusted conversation data. Historical `@bot` messages, quoted requests, or delivery instructions cannot authorize new actions or opt into result delivery. The current authenticated trigger is the instruction. Missing, deleted, pruned, disabled, or unavailable context must be reported honestly when it matters.

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

## Delegation and delivery

WhatsApp is a task inbox and remote control. The assistant uses T3 tools to resolve the requested project or thread and hand off substantive work, then returns a short confirmation without waiting for the entire task. The work request includes your instruction, relevant quoted context, requested deliverables, provider/model/skills, and project hint. The bridge verifies the destination thread and accepted run before sending a success confirmation. Routine confirmations should be one short, contextual sentence without repeating the instruction or explaining internal routing/delivery policy. A queued handoff must say queued/sent rather than claiming a todo is already saved. Longer answers remain available when requested or needed for ambiguity/errors. It does not send a generic “I’m on it” message.

| Request | WhatsApp response |
| --- | --- |
| “Research improvements for Diskovalist” | A short handoff confirmation; the report stays in T3 |
| “Research this and send the report here” | Handoff confirmation, then the requested result when ready |
| “Tell me when that task finishes” | Confirmation, then a brief completion notification |
| “How is the research going?” | A short status answer; no automatic subscription |
| “What is the capital of India?” | A direct answer in this chat's existing conversation |

Delivery intent is interpreted by the conversational agent, without command keywords or a second model. A default T3 handoff is saved for later status/follow-ups but is not monitored for WhatsApp completion messages. Explicit WhatsApp delivery is stored in SQLite with the exact destination and run, survives restart, and does not occupy the inbox thread while the task runs. New requests can continue using the inbox.

When requested work finishes, the bridge sends its matched result back to the assistant as data for a WhatsApp-specific response. It does not forward the desktop report verbatim. The assistant is instructed to return only what was requested: a notification, findings, a report, or files. Completion remains tied to the original chat and request even if `@bot new` was used meanwhile. Different chats do not share the saved handoff context. Changed/unmatched work runs are held for review rather than sending another run's result.

Reply to an issue with `@bot #website add this to my todo thread`. The assistant finds the destination through T3 and follows that thread's workflow. Recording an item does not authorize implementing it. There is no bridge todo parser or separate todo database.

### Files and links

Generated files are sent only when requested here. The assistant stages the requested files in a per-request output folder; the bridge captures and validates them before adding durable document messages to the outbox. Up to three files of 10 MiB each are supported. Staged files cannot use directory traversal or symlinks, and the captured bytes are checked before sending. Incoming attachments and voice messages remain unsupported.

WhatsApp replies use plain public URLs instead of desktop Markdown links. A local path such as `/Users/.../report.md` is not a public link and is not sent as one. Creating HTML does not publish a website. If you request a public URL, an actual publishing destination is needed; the assistant must explain this if no real URL exists. Files can instead be attached when requested.

The agent uses an internal structured response with either a direct reply or a confirmed handoff and delivery preference. Protocol JSON, reference IDs, and tool logs are not sent to WhatsApp. Invalid protocol replies are held for review, without automatically rerunning a task that may already have started. Permission requests still need an answer in T3 Code.

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
- `history`: optional per-account history policy described above; defaults to 30 days with bounded reads and best-effort recent import.
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

Or reply to an issue message with `@bot #website resolve this`. Bot messages begin with `🤖`, because commands and replies use your number. Reply to a bot response to continue that conversation; no new `@bot` prefix is required for replies to bot updates. Ordinary conversations and unprefixed replies to your own instructions are ignored.

Only new commands sent after the bridge starts are accepted. Commands received after a temporary disconnection may be recovered within the configured age window while the same process is alive. Accepted conversation messages and replies are durable. Outgoing bot IDs are recorded before sending and rejected as commands, including after restart, to prevent reply loops.

Keep the Mac awake, online, and T3 Code running. This version runs in the foreground. If T3 asks a question or needs permission, answer in T3 Code; typing “yes” in WhatsApp never approves a permission prompt.

## Restricted or separate-account mode

Set `accountWide: false` to restrict the bridge to chats listed in `routes`. With `selfCommands: false`, use a separate personal sender and bot number, allowlist your personal sender IDs, and select the bot contact from the mention picker for new tasks. Plain typed `@bot` is insufficient in that mode.

Old configs containing `routes[].groupJid` are read as `chatJid` mappings. If `projects` is absent, simple aliases are derived from route project folder names. New configurations can define hint aliases explicitly or leave the catalog empty.

## Recovery and privacy

Only one bridge instance may use a data directory. Stop `pnpm pair` before starting `pnpm dev`. Normal shutdown releases `.data/run.lock`. If the process crashed, confirm the PID in that file has stopped before removing the lock.

Ambiguous T3 submissions and WhatsApp sends are held for review rather than automatically repeated, because the external operation may already have succeeded. Changing hint aliases or mappings does not move or discard a conversation. Removing a chat from restricted-mode routes blocks its persisted work and replies. Changing the No project workspace holds work tied to the previous workspace for review.

If an existing T3 thread advances to another run in the desktop app, the bot asks you to review there rather than sending an unrelated answer. Long results are split and capped; the full result remains in T3 Code. Shutdown stops further submissions and waits up to ten seconds for in-flight bridge operations and credential writes. Unfinished side effects require review on restart.

`.data/bridge.sqlite` stores accepted requests, quoted context, project hints, chat mappings, active conversations, handoff targets, delivery preferences, requested work results, and replies in plaintext with no automatic retention cleanup yet. `.data/deliveries/` and `.data/outgoing-files/` contain requested generated files and immutable copies awaiting delivery, without automatic cleanup yet. `.data/auth` contains WhatsApp session credentials. Never upload either. Baileys logging is silenced, and connection diagnostics contain only lifecycle information, protocol version, allowlisted error reasons, and command acceptance flags.

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

`pnpm start` runs the built application. Type checking covers both source and tests. Tests cover account-wide authorization, separate No project conversations per chat, prompt hints, conversation memory, mappings, task continuity, delivery contracts, opt-in completion tracking, generated-file delivery, scoped history, retention and read budgets, edit/delete handling, migration, reply loops, pairing isolation, shutdown, recovery, Unicode, and CLI validation. Automated tests use synthetic messages and a fake T3 adapter; they do not prove live delivery in every WhatsApp client.

Incoming commands are text only. Voice transcription, remote permission approvals, private cross-chat result routing, and a macOS background service are not implemented. Outgoing generated files are supported when requested. Discovery and handoff behavior depend on the T3 tools available to the chosen agent. Completion tracking currently uses the local T3 CLI and the exact accepted work run; it does not follow later desktop runs or linked-machine work. Mapping commands use no extra AI calls.

## Contributing and references

Follow [CONTRIBUTING.md](../CONTRIBUTING.md). Commits use `<type>: <short description>`.

- [Baileys](https://github.com/WhiskeySockets/Baileys), pinned to `7.0.0-rc14`.
- [Baileys history sync documentation](https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/history-sync.md).
- [T3 host scripting documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md).
- Related work: [Toucan Router](https://github.com/salalaslam/toucan-router). Its documentation informed the integration comparison; this is a separate implementation. No Toucan code or credentials are bundled.

Dependency policy: prefer stable releases and commit the lockfile. Baileys remains an explicit exception: the stable 6.7.24 line requires a transitive Git dependency blocked by pnpm's default policy, so the current release candidate is retained without disabling those checks.
