# Contributing

## Commit message convention

Use this format:

```text
<type>: <short description>
```

Allowed types:

- `feat`: new feature
- `fix`: bug fix
- `hotfix`: production fix
- `refactor`: internal code change, no behavior change
- `chore`: tooling, configs, dependencies
- `docs`: documentation only
- `test`: tests only

Keep the description concise and specific. Keep each commit focused on one coherent change. Use the type that describes the main purpose when a feature or fix also includes its tests and documentation.

Examples:

```text
feat: route WhatsApp tasks by project hashtag
fix: prevent bot replies from starting new tasks
chore: update pinned dependencies
```

## Validation

Use pnpm. Before committing implementation changes, run the relevant checks:

```sh
pnpm check
pnpm test
pnpm build
```

Never commit local WhatsApp sessions, QR codes, runtime databases, private configuration, logs, or secrets. These belong in the gitignored data directory or configuration file.
