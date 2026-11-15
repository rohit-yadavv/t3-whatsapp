<p align="center">
  <img src="assets/logo.png" alt="T3 WhatsApp logo" width="200" />
</p>

# T3 WhatsApp

**Your WhatsApp companion for T3 Code.**

Send tasks and continue agent conversations in your projects and threads directly from existing chats and groups, using your own WhatsApp account.

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

Send commands in a chat, group, or **Message yourself**. Reply to an issue to include its text as context.

```text
@bot hi
@bot #website explain this project
@bot #website add this to my Launch planning thread
@bot what did you find?
```

- Each new chat or group gets its own **No project** conversation. Later messages in that chat continue it, including after restart.
- Mention projects and thread titles naturally; the agent uses T3 tools to find them and perform your request.
- `#project` and chat mappings add project context to the prompt. The conversation stays in No project.
- Reply to an older bot message to continue its conversation, or send exactly `@bot new` to reset this chat.
- Use `@bot use website for this chat` to save a default project hint; `@bot unmap this chat` clears it.

**Only your own account can issue commands. Replies appear in the same chat, visible to its members.** Use Message yourself for private conversations. Permission requests must be answered in T3 Code.

## License

[MIT](LICENSE) © 2026 Rohit Yadav.
