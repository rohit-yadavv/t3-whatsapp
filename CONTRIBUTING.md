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

## Releases

CI runs type checking, tests, and the build on pull requests. The Release Please
workflow runs the same checks on pushes to `main`, before any release automation.
It covers the minimum supported Node version on Linux and Node 24 on Linux and
macOS. The native launchd integration test remains opt-in (`T3_TEST_LAUNCHD=1`);
the normal macOS test suite exercises the automatic startup logic with fixtures.

Releases are stable source snapshots on GitHub. They use GitHub's automatic source
archives, which contain the setup skill, installation instructions, and lockfile
expected by [INSTALL.md](INSTALL.md). Users install dependencies from that snapshot;
there is no npm publication or automatic update step.

To publish a release:

1. Merge changes into `main` using the commit convention above. When squash
   merging, the PR title becomes the commit subject and must follow that convention.
2. After checks pass, Release Please opens or updates a release PR. It manages
   `package.json`, `CHANGELOG.md`, and `.release-please-manifest.json` together.
3. Review and merge the release PR when ready. Checks run again on the merged
   commit; only after they pass does Release Please create the version tag and
   publish the stable GitHub release.

The first release is explicitly configured as **v0.1.0**. The empty manifest means
no version has been released yet; Release Please fills it in with the first release
PR. Do not prefill it with `0.1.0` or manually bump package versions or push release
tags. `initial-version` only controls the first release, so it can stay at `0.1.0`.

After the first release, `fix:` and `hotfix:` produce a patch bump; `feat:` produces
a minor bump. A `BREAKING CHANGE:` footer produces a minor bump while below 1.0.0,
and a major bump from 1.0.0 onward. Documentation, refactoring, tooling, and test
commits alone do not trigger a release. Hotfixes appear under Bug Fixes in the
changelog. Release PR titles use `chore: release <version>`.

Release configuration lives in `release-please-config.json`. Draft and prerelease
publication are disabled. The workflow validates stable versions, matching package
and manifest versions, and required installation files before running Release Please.
It can be rerun manually on `main` from Actions after resolving a failure. Do not
move or reuse published tags; ship corrections in a new version.

### GitHub permissions and optional PR checks

GitHub Actions must be enabled, and Settings → Actions → General → Workflow
permissions → **Allow GitHub Actions to create and approve pull requests** must be
enabled. Only the release job requests write access to contents, issues, and PRs;
the checks use read-only repository access. Release PRs are merged by a maintainer.

By default the workflow uses `GITHUB_TOKEN`, with no extra secret. GitHub does not
trigger new PR or tag workflows for events created using that token. Release
publication is still gated by the checks on `main` in the same workflow; it does
not depend on a second tag workflow. Bot-created release PRs do not automatically
receive the PR CI checks with this default setup.

If branch protection requires checks on the release PR before merging, configure
a GitHub App installation token or a fine-grained personal access token as the
`RELEASE_PLEASE_TOKEN` Actions secret. It needs access to this repository with
Contents, Issues, and Pull requests write permissions. For App tokens, arrange
token generation and refresh in the workflow; do not save an expiring installation
token as a permanent secret. The workflow uses the secret when present, allowing
bot-created PRs to trigger normal CI. Never put credentials in repository files.

Until the first release PR is merged and publication succeeds, the documented
fresh installation flow is unavailable. Existing installations stay on their
installed version unless the user explicitly requests an upgrade.
