<p align="center">
  <img src="assets/logo.png" alt="T3 WhatsApp logo" width="200" />
</p>

# T3 WhatsApp

**Your WhatsApp companion for T3 Code.**

Delegate tasks to T3 Code from existing chats and groups, using your own WhatsApp account.

## Setup

Requires Node.js 22.13+, pnpm 12.21.0, and T3 Code running locally with your projects registered and `t3` available on your PATH.

1. Install dependencies and link your WhatsApp account:

   ```sh
   pnpm install --frozen-lockfile
   pnpm pair
   ```

   Scan the QR image using WhatsApp → Linked devices. Once paired, stop pairing with Ctrl+C.

2. Create your local configuration:

   ```sh
   cp config.example.json config.json
   ```

   Set `allowedSenderJids` to the account identifiers printed during pairing. Keep `selfCommands` and `accountWide` enabled to use your own account across chats. Project aliases under `projects` are optional prompt hints.

3. Check the configuration and start:

   ```sh
   pnpm run doctor
   pnpm dev
   ```

Keep your computer awake, online, and T3 Code running.

## Usage

Send commands in a chat, group, or **Message yourself**. Reply to an issue to include its text as context. Tasks get a short confirmation after T3 accepts the handoff. Work and results stay in T3 unless you ask for them here. Simple questions get a direct answer.

```text
@bot hi
@bot #website research improvements and create a report
@bot #website add this to my Launch planning thread
@bot research Diskovalist and send the report here
@bot tell me when that task finishes
@bot how is the research going?
```

- Each new chat or group gets its own **No project** conversation. Later messages continue it, including after restart. If you settle that thread in T3, the next message starts a fresh No project conversation.
- Ask for “the report here”, “attach it”, or “let me know when it finishes” to opt into WhatsApp delivery. Requested files are attached; local file paths are never presented as public links.
- Text from personal chats and groups is kept locally for 30 days, including ordinary messages and bot replies. The agent retrieves relevant context on demand; history never triggers commands. Retention and retrieval limits are configurable in `config.json`. Available recent phone history is imported on a best-effort basis.
- Mention projects and thread titles naturally; the agent uses T3 tools to find them and perform your request.
- `#project` and chat mappings add project context to the prompt. The conversation stays in No project.
- Reply to an older bot message to continue its conversation, or send exactly `@bot new` to reset this chat.
- Use `@bot use website for this chat` to save a default project hint; `@bot unmap this chat` clears it.

Routine bot confirmations stay short and contextual, with verified wording such as “Queued the onboarding todo in T3.”

See [history and configuration](docs/configuration.md#local-conversation-history) for retention settings and the scoped reader.

**Only your own account can issue commands. Replies appear in the same chat, visible to its members.** Use Message yourself for private conversations. Permission requests must be answered in T3 Code.

## License

[MIT](LICENSE) © 2026 Rohit Yadav.
