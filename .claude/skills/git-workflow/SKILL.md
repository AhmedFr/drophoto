---
name: git-workflow
description: Git and GitHub flow for this repo — issues, branch naming, conventional commits, PRs, CI gates. Use before starting any task, creating a branch, committing, or opening a PR.
---

# Git workflow (drophoto)

## Flow
1. **Issue first.** Every unit of work has a GitHub issue (`gh issue create`). Label: `phase:N`, `area:core|ui|ingest|infra`, `type:feat|fix|chore|spike`.
2. **Branch from `main`**: `<type>/<issue#>-<short-kebab>` e.g. `feat/12-drive-scan-job`. Spikes: `spike/<issue#>-<topic>` — never merged, findings go in the issue.
3. **Commits**: Conventional Commits, scoped: `feat(ingest): verify copies with blake3`. Small, buildable commits. Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` when Claude authored.
4. **PR** via `gh pr create`: title = conventional commit style; body has `Closes #N`, summary, test plan, screenshots for UI. Draft until CI green.
5. **CI gates** (required): `pnpm lint`, `pnpm typecheck`, `pnpm test --coverage` (thresholds in test-coverage skill), `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `pnpm tauri build --debug`.
6. **Merge**: squash-merge, delete branch. `main` is always releasable.

## Rules
- Never commit directly to `main`.
- Never force-push shared branches.
- No secrets, no fixtures > 2 MB (use small test media).
- Rebase on `main` before opening/merging the PR.
