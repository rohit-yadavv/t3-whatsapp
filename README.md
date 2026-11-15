<p align="center">
  <img src="assets/logo.png" alt="T3 WhatsApp logo" width="200" />
</p>

# T3 WhatsApp

Use T3 Code from WhatsApp. Send tasks and continue agent conversations in your projects and threads directly from existing chats and groups, using your own WhatsApp account.

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

   Set `allowedSenderJids` to the account identifiers printed during pairing and map your project aliases under `projects`. Keep `selfCommands` and `accountWide` enabled to use your own account across chats.

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
@bot #website ~"Launch planning" what remains to do?
@bot what did you find?
```

- `#project` selects a configured project; `~thread` selects an existing thread.
- The bot remembers this chat's active project and thread. Fresh, unmapped chats use **No project**.
- Reply to a bot message to continue its task, or use `@bot new` to reset the active conversation.
- Use `@bot use website for this chat` to save a default project.

**Only your own account can issue commands. Replies appear in the same chat, visible to its members.** Use Message yourself for private conversations. Permission requests must be answered in T3 Code.

## Notes

This is an unofficial integration using [Baileys](https://github.com/WhiskeySockets/Baileys); WhatsApp changes or account restrictions can interrupt it. Agent usage counts toward your configured provider's allowance or API billing.

Text messages only. Keep `config.json` and `.data/` private; they contain configuration, session credentials, and conversation data.

See the [configuration and reference guide](docs/configuration.md) for all commands, troubleshooting, and current limitations. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).
