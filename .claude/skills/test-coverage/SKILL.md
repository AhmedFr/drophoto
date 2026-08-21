---
name: test-coverage
description: Testing and coverage policy for this repo — what to test, where, thresholds, and how to run. Use when writing code, adding tests, or checking CI coverage failures.
---

# Test coverage (drophoto)

## Thresholds (enforced in CI)
- Frontend (Vitest, v8): **80% lines / 75% branches** global; `src/lib/**` and `src/features/**/logic/**` **90%**. shadcn-generated `src/components/ui/**` excluded.
- Rust: `cargo llvm-cov` **80% lines** on capability crates (`crates/*`); tauri wiring crate excluded.

## What to test where
- **Pure logic** (templates, planner, formatters, hooks): unit tests, exhaustive edge cases. TDD: write the failing test first.
- **Capability impls** (exiftool, ffmpeg, sips, geocoder): integration tests over `fixtures/` media; skipped with a clear message if the sidecar is absent locally, never skipped in CI.
- **Components**: Testing Library — render, interaction, a11y roles; Tauri `invoke` mocked via `@tauri-apps/api/mocks`. Storybook story per component (counts as visual coverage, not line coverage).
- **Jobs** (scan/ingest): integration tests on a temp dir + in-memory SQLite; assert source untouched, destination verified, progress events emitted.
- **E2E** (later): Playwright smoke for scaffold → scan → gallery.

## Commands
- `pnpm test` / `pnpm test --coverage` / `pnpm test:ui`
- `cargo test --workspace` / `cargo llvm-cov --workspace --html`

## Rules
- A bug fix ships with a regression test.
- No `it.skip` on `main`; use `it.todo` with an issue link.
- Don't test shadcn internals; test your composition of them.
