---
name: t3-whatsapp-setup
description: Set up or diagnose the T3 WhatsApp bridge from its repository checkout using its local setup page and structured diagnostics. Use for installation, WhatsApp linking, and initial configuration; not for administering WhatsApp accounts or changing T3 itself.
---

# T3 WhatsApp setup

Read [SETUP.md](../../SETUP.md) in this repository for supported commands, check codes, and recovery. Use the checkout's pnpm scripts; do not invent a globally installed `t3-whatsapp` command. This repository ships the skill for agents to read; setup does not install it into global agent settings.

Start with `pnpm doctor --json` after installing dependencies with `pnpm install --frozen-lockfile` if needed. A nonzero diagnostic exit can still contain valid JSON. Use `pnpm config:show --json` to inspect setup preferences without reading credentials. Fix missing prerequisites within the user's authorized scope, then run `pnpm setup` in a persistent user-visible terminal.

The page and CLI use the same setup logic. Let the user scan the QR and explicitly choose chat access and history. New installs start with self-chat access and history disabled; existing access settings are preserved by default. An agent may operate the page when browser tools and authorization are available, but must not silently widen access or history collection. Do not start T3, create projects, install services, or change global settings as an implicit part of bot setup.

Keep the full setup URL, QR, auth files, account identifiers, and raw conversation data out of agent replies. Explain where the local page opened without echoing its access token. Do not scrape pairing logs or request credentials in chat.

Respect live locks and preserve configuration, mappings, conversations, and pending work. Never remove a session/data directory or retry ambiguous external work to make a diagnostic pass. Review owner mismatches and workspace changes explicitly. Stop only the setup process or child bridge you started, never an unrelated PID.

Finish by checking live connection in the page and asking the user to send `@bot hi` in an enabled chat. Report whether connection, command acceptance, and reply sending were actually observed. A saved session or passing read-only doctor report does not establish end-to-end success. Tell the user that stopping the setup terminal stops its child bridge, and point to `pnpm dev` for independent foreground operation.
