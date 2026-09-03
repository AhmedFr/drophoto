---
name: git-workflow
description: Git and GitHub flow for this repo — issues, branch naming, conventional commits, PRs, CI gates. Use before starting any task, creating a branch, committing, or opening a PR.
---

# Git workflow (drophoto)

## Flow
1. **Issue first.** Every unit of work has a GitHub issue (`gh issue create`). Label: `phase:N`, `area:core|ui|ingest|infra`, `type:feat|fix|chore|spike`.
2. **Branch from `main`**: `<type>/<issue#>-<short-kebab>` e.g. `feat/12-drive-scan-job`. Spikes: `spike/<issue#>-<topic>` — never merged, findings go in the issue.
3. **Commits**: Conventional Commits, scoped: `feat(ingest): verify copies with blake3`. Small, buildable commits. Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` when Claude authored.
4. **PR** via `gh pr create`: title = conventional commit style; body has `Closes #N`, summary, test plan, screenshots for UI. Paste the `pnpm check` output as the test evidence — no CI runs on PRs.
5. **Gates** (required, run locally): `pnpm check` = `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (thresholds in test-coverage skill), `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `pnpm tauri build --debug --no-bundle`. `pnpm install` wires `pnpm check:fast` (everything but the Tauri build) into a pre-push hook; `SKIP_CHECKS=1 git push` bypasses it — emergencies only. GitHub Actions is deactivated (manual `workflow_dispatch` only, since 2026-09-03; macOS minutes bill at 10x): nothing runs on PRs or on `main`, so a full `pnpm check` on the final commit is the only gate before merging.
6. **Merge**: squash-merge, delete branch. `main` is always releasable.

## Rules
- Never commit directly to `main`.
- Never force-push shared branches.
- No secrets, no fixtures > 2 MB (use small test media).
- Rebase on `main` before opening/merging the PR.
