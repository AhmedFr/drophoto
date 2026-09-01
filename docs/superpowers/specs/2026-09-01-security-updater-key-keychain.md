# Security: updater signing key moves into the macOS Keychain

**Date:** 2026-09-01 · **Origin:** appsec audit 2026-09-01, Risk 1 (Medium, `key_management`) · **Status:** approved in conversation 2026-09-01

## Problem

`scripts/release.sh:61-64` reads the tauri-plugin-updater minisign private key from
`~/.tauri/drophoto_updater.key` and exports `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` —
the key sits **unencrypted on disk**. Any process or user able to read the dev
machine's home directory can sign a malicious update that every installed copy of
drophoto will accept as genuine (the pubkey is pinned in `tauri.conf.json`, and the
GitHub release channel delivers whatever `latest.json` points at). This key is the
single gate on code delivery to all installs.

## Constraints

- **The key cannot be rotated.** Every shipped build pins the current pubkey;
  rotation silently and permanently breaks auto-update for all of them
  (`release.sh` already guards against accidental rotation). So the fix must
  protect the *existing* key material, not generate a new encrypted keypair.
- The minisign key content itself stays passwordless (tauri has no re-encrypt
  flow), so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` remains — the protection is
  **at-rest storage + Keychain ACL**, not a passphrase on the key blob.
- `release.sh` must **fail closed**: it must never silently fall back to a
  plaintext key file.

## Design

Store the private key as a generic password in the **login Keychain**
(service `drophoto-updater-key`, account `$USER`). The key is encrypted at rest
by the Keychain and only readable while the user's login keychain is unlocked.

**ACL choice:** the item keeps the default ACL (created via `security`, so later
`security find-generic-password` reads don't prompt). A prompt-on-every-read ACL
(`-T ""`) would be stronger against live same-user malware, but it blocks any
scripted readback verification on a GUI prompt; and the audit's stated risk is
**at-rest** exposure (plaintext in the home dir — backups, disk images, other
users, accidental sync), which the default ACL already closes. The user can
tighten the ACL later in Keychain Access if desired.

### 1. `scripts/updater-key-to-keychain.sh` (new, one-time migration, user-run)

1. Refuse if `~/.tauri/drophoto_updater.key` is missing.
2. If a Keychain item already exists: compare with the file; identical → say so,
   skip to step 5; different → hard error (never overwrite key material).
3. `security add-generic-password -s drophoto-updater-key -a "$USER" -w "$(cat key)"`
   (default ACL — see "ACL choice" above).
4. Read it back (`security find-generic-password … -w`) and verify byte-identical
   to the file — abort loudly on mismatch.
5. Prompt (interactive y/N) to delete the plaintext `~/.tauri/drophoto_updater.key`.
   `~/.tauri/drophoto_updater.key.pub` stays on disk — it is public and
   `release.sh`'s rotation guard reads it.
6. Remind: the Keychain item is now the only local copy; keep the existing
   offline backup (password manager) per `updater-keygen.sh`'s instructions.

### 2. `scripts/release.sh` (changed)

- Replace the file read with
  `TAURI_SIGNING_PRIVATE_KEY="$(security find-generic-password -s drophoto-updater-key -w)"`.
- If the plaintext key file still exists → error: "run
  scripts/updater-key-to-keychain.sh first (and let it delete the file)" —
  fail closed whether or not the Keychain item exists, so the plaintext copy
  can't quietly linger.
- If neither file nor Keychain item exists → keep today's "run
  scripts/updater-keygen.sh first" error.
- The pubkey-mismatch rotation guard is unchanged (still reads `…key.pub`).

### 3. `scripts/updater-keygen.sh` (changed, for the fresh-machine path)

After `pnpm tauri signer generate` writes the pair: import the private half into
the Keychain (same item + readback verification as the migration script), then
delete the plaintext `.key` file. `.key.pub` stays. The "back it up outside this
repo" instruction stays.

## Out of scope

- Rotating or passphrase-encrypting the key (breaks shipped builds / unsupported).
- CI signing (there is no CI release path; releases are local by policy).
- Hardware-token (Secure Enclave/YubiKey) storage — minisign key import isn't
  supported there; noted as a future option only.

## Testing

Shell-only change; no cargo/vitest surface. Verification is manual + static:

- `sh -n` on all three scripts; `shellcheck` clean if installed.
- Dry-run the migration script against a **throwaway** key file + throwaway
  service name (`DROPHOTO_KEYCHAIN_SERVICE` env override, default
  `drophoto-updater-key`) proving: import, readback-verify, idempotent re-run,
  mismatch refusal. The real migration is run once by the user, not by CI.
- `release.sh` guard paths exercised with the override service absent/present.

## Rollout

User action after merge (one-time): run `scripts/updater-key-to-keychain.sh`
and approve the plaintext-deletion prompt. `scripts/release.sh` then works
unchanged (no Keychain prompt with the default ACL).
