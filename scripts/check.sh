#!/usr/bin/env bash
# Local merge gate. CI only runs on `main` (macOS runners bill at 10x), so
# this is what every branch must pass before it is pushed or merged.
#
#   pnpm check         full suite, identical to the `main` workflow
#   pnpm check:fast    everything except the Tauri build (the pre-push hook)
#
# Bypass the hook for an emergency push with: SKIP_CHECKS=1 git push
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fast=0
[[ "${1:-}" == "--fast" ]] && fast=1

step() {
  printf '\n\033[1;34m▶ %s\033[0m\n' "$*"
  "$@"
}

step pnpm lint
step pnpm typecheck
step pnpm test:coverage
step cargo fmt --all --check
step cargo clippy --workspace --all-targets -- -D warnings
step cargo test --workspace
if (( ! fast )); then
  step pnpm tauri build --debug --no-bundle
fi

printf '\n\033[1;32m✔ all gates passed\033[0m\n'
