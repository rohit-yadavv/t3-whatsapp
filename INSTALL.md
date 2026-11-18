# Installation instructions for T3 Code

Agent entry point for the setup prompt in [README.md](README.md#setup). Prepare the bot, then continue with its setup skill. The agent installs the user-level WhatsApp sending skill as part of setup.

## 1. Prepare the installation

- For an existing installation, go directly to its [setup skill](skills/t3-whatsapp-setup/SKILL.md). A setup request does not imply an upgrade; never overwrite its files or start a competing bot.
- Otherwise, select the latest stable [release](https://github.com/rohit-yadavv/t3-whatsapp/releases), or the requested version. Resolve the tag to a commit and download that commit's source archive. If unavailable, report the blocker; do not substitute `main`.
- Inspect archive entries before extraction; reject paths or links escaping the destination. Confirm `package.json`, `pnpm-lock.yaml`, `INSTALL.md`, and `skills/t3-whatsapp-setup/SKILL.md` exist. Read the release's instructions before running scripts.
- Use an empty, permanent folder: `~/.local/share/t3-whatsapp` on macOS/Linux or `%LOCALAPPDATA%/t3-whatsapp` on Windows, unless the user chose another location. Inspect an occupied destination before proceeding.
- Use `engines` and `packageManager` in `package.json` for Node and pnpm requirements. Install missing prerequisites within the authorized scope without replacing an existing runtime or changing unrelated global settings.

## 2. Install dependencies

Run from the installation folder:

```sh
pnpm install --frozen-lockfile
```

Resolve installation failures before continuing; do not bypass the lockfile. Keep the installation folder, dependencies, and Node executable in place. This flow does not include automatic updates.

## 3. Continue with setup

Report the installation folder and release version, then follow the installed [setup skill](skills/t3-whatsapp-setup/SKILL.md). It covers diagnostics, configuration, live verification, and [installing the sending skill](skills/t3-whatsapp-setup/SKILL.md#3-install-the-sending-skill). Do not stop at downloading files or giving the user commands.
