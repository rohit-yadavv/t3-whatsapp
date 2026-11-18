# Project instructions

- Use pnpm for dependency management and project scripts.
- Follow the commit convention in [CONTRIBUTING.md](CONTRIBUTING.md): `<type>: <short description>`.
- Allowed commit types: `feat`, `fix`, `hotfix`, `refactor`, `chore`, `docs`, `test`.
- Create commits only when explicitly requested or approved by the user. When authorized, keep them focused on verified work.
- Keep session credentials, QR images, local config, runtime data, and logs out of Git.
- Preserve own-account authorization, bot echo suppression, task/thread continuity, and conservative recovery for ambiguous external side effects.
- When explicitly asked to send a WhatsApp message from T3 Code, follow [the outbound messaging instructions](docs/outbound.md) and wait for the user to approve the exact preview before sending.

## Installing or configuring the bot

For a new installation, start with [INSTALL.md](INSTALL.md). For setup or reconfiguration of an existing installation, follow the [setup skill](skills/t3-whatsapp-setup/SKILL.md).
