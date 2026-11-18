---
name: t3-whatsapp-setup
description: Configure or diagnose an installed T3 WhatsApp bot, launch its local setup page, link WhatsApp, and verify replies. For first-time download and installation, start with INSTALL.md.
---

# T3 WhatsApp setup

Use this procedure from an existing installation. If the bot is not installed, follow [INSTALL.md](../../INSTALL.md) first, then return here. Read this setup skill locally. Install only the separate sending skill described below for user-wide discovery.

## 1. Check and launch

Run from the installation folder. If dependencies are missing, install them with `pnpm install --frozen-lockfile` before continuing:

```sh
pnpm run doctor --json
pnpm config:show --json
pnpm run setup
```

- Doctor may exit nonzero with useful JSON. Missing configuration or pairing is expected on a fresh install; resolve it through the page. Read other failures using the operational reference. A saved session does not prove a live connection.
- Launch `pnpm run setup` in a persistent user-visible terminal and keep it alive during configuration. It starts the UI server and attempts to open the browser.
- On Windows or if opening fails, open the page using available tools or direct the user to the private URL in their terminal. Never copy its token into chat.
- If a persistent terminal is unavailable, report the limitation and remaining step; do not claim setup is running.

## 2. Guide the user in the page

1. **Check T3:** the page detects the local installation. Ask the user to open T3 if needed; do not start T3 or create projects yourself.
2. **Link WhatsApp:** let the user scan the QR from WhatsApp → Linked devices. Reuse a valid saved session.
3. **Choose preferences:** new installs default to Message yourself only and history off. The user chooses access and history; never widen either silently. Explain that group replies are visible to members and enabled history can reach the configured AI provider.
4. **Finish:** macOS 12+ defaults to **Start automatically with T3**. Preserve a saved Pause or opt-out. Other platforms use the page's foreground test.
5. **Verify:** ask the user to send `@bot hi` in an enabled chat. Report live connection, command acceptance, and reply delivery only when observed; do not send the test on their behalf.

## 3. Install the sending skill

On the machine running the bot, verify that the installed release includes `docs/outbound.md` and a `whatsapp` script in `package.json`. If either is missing, the installed release does not support sending from T3 threads. Report that and continue the normal setup.

Create `t3-whatsapp/SKILL.md` under the user's shared T3 Code skills directory. Use `~/.agents/skills` (the Windows equivalent is `%USERPROFILE%\.agents\skills`) unless the user has configured another shared skills directory. The agent performs this step. If the destination already points to this installation and follows its current outbound workflow, reuse it. If it points elsewhere or contains unrelated instructions, preserve it and report the conflict.

Use this content. Replace both placeholders with absolute paths to the actual installation and its `docs/outbound.md`, respectively.

```markdown
---
name: t3-whatsapp
description: Prepare and send WhatsApp text messages from T3 Code through the paired local bot. Use for requests to message a WhatsApp contact or group, send a thread update, approve a pending preview, or check a previous send.
---

# T3 WhatsApp

Use the bot installed at `<INSTALLATION_PATH>`. Read the outbound instructions at `<OUTBOUND_DOC_PATH>` for the preview, confirmation, and status commands.

For an explicit send request, prepare a preview and show the exact recipient and message, including 🤖. Wait for the user's approval in a later message in this T3 thread before confirming that preview. Prepare a new preview if the recipient or text changes or the preview expires. Draft requests do not authorize sending. Check status before attempting another send if the outcome is uncertain.
```

Read the installed skill back and verify that both paths point to this installation. No live outbound message is needed to verify the skill. Tell the user they can ask to send on WhatsApp from a new local T3 thread or invoke `$t3-whatsapp` explicitly.

## 4. Hand off

- With automatic startup enabled, setup and its terminal can close. Otherwise, closing the test terminal stops the bot. Keep the computer awake and online.
- For later settings changes, launch setup again. **Save and reconnect** applies a draft to the owned runtime; **Cancel** leaves it unchanged. Preserve a paused state unless explicitly enabled.

## Preserve existing work

- Keep setup URLs, QR codes, credentials, account identifiers, and conversation data out of replies and Git.
- Preserve configuration, sessions, mappings, and pending work. Never delete data, log out, or retry ambiguous submissions/sends to make a check pass.
- Pause before re-pairing or editing configuration from the CLI. Never stop an unrelated process; review account or workspace mismatches explicitly.
- For startup, locks, or configuration errors, read [the operational reference](../../docs/configuration.md#startup-and-recovery).
