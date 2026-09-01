#!/bin/sh
# One-time migration: moves the updater signing key from its plaintext file
# (~/.tauri/drophoto_updater.key) into the login Keychain, where it is
# encrypted at rest instead of sitting readable in the home directory
# (issue #28 — the key gates code delivery to every installed copy, and it
# can never be rotated without breaking their auto-update, so the existing
# material is what gets protected).
#
# Safe to re-run: an identical Keychain item is recognized and skipped; a
# DIFFERENT one is a hard error — this script never overwrites key material.
# The public half (…key.pub) stays on disk: it is public, and release.sh's
# rotation guard reads it.
#
# The item keeps the default Keychain ACL (readable via `security` without
# a per-read prompt) — the protection is at-rest encryption + the unlocked
# login keychain, which is exactly the exposure the plaintext file had.
# Tighten the ACL in Keychain Access afterwards if you want read prompts.
#
# DROPHOTO_KEYCHAIN_SERVICE / DROPHOTO_UPDATER_KEY_PATH are test hooks so
# the flow can be exercised against a throwaway item + key file.
#
# Usage: scripts/updater-key-to-keychain.sh
set -eu
SERVICE="${DROPHOTO_KEYCHAIN_SERVICE:-drophoto-updater-key}"
KEY_PATH="${DROPHOTO_UPDATER_KEY_PATH:-$HOME/.tauri/drophoto_updater.key}"
ACCOUNT="$USER"

EXISTING="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null || true)"

if [ ! -f "$KEY_PATH" ]; then
    if [ -n "$EXISTING" ]; then
        echo "nothing to do: $KEY_PATH is gone and the Keychain item '$SERVICE' exists —"
        echo "the migration already ran."
        exit 0
    fi
    echo "error: $KEY_PATH not found and no Keychain item '$SERVICE' exists." >&2
    echo "run scripts/updater-keygen.sh to generate a keypair (fresh machine), or" >&2
    echo "restore the key from your backup to $KEY_PATH and re-run this script." >&2
    exit 1
fi

KEY_CONTENT="$(cat "$KEY_PATH")"

if [ -n "$EXISTING" ] && [ "$EXISTING" != "$KEY_CONTENT" ]; then
    echo "error: the Keychain item '$SERVICE' already exists and DIFFERS from $KEY_PATH." >&2
    echo "refusing to overwrite key material — work out which one is the real signing key" >&2
    echo "(the one whose public half matches src-tauri/tauri.conf.json's plugins.updater.pubkey)" >&2
    echo "and delete the wrong copy yourself first." >&2
    exit 1
fi

if [ -z "$EXISTING" ]; then
    security add-generic-password -s "$SERVICE" -a "$ACCOUNT" -w "$KEY_CONTENT"
    READBACK="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)"
    if [ "$READBACK" != "$KEY_CONTENT" ]; then
        echo "error: Keychain readback does not match $KEY_PATH — NOT deleting the file." >&2
        echo "inspect the '$SERVICE' item in Keychain Access before re-running." >&2
        exit 1
    fi
    echo "==> imported the key into the login Keychain (service '$SERVICE') and verified readback."
else
    echo "==> the Keychain item '$SERVICE' already holds this exact key — nothing to import."
fi

printf "delete the plaintext %s now? [y/N] " "$KEY_PATH"
read -r ANSWER
case "$ANSWER" in
y | Y)
    rm "$KEY_PATH"
    echo "==> deleted $KEY_PATH — the Keychain item is now the only local copy."
    echo "    keep your offline backup (password manager); to view the key for backup:"
    echo "    security find-generic-password -s '$SERVICE' -w"
    ;;
*)
    echo "==> kept $KEY_PATH. NOTE: release.sh refuses to run while the plaintext file" >&2
    echo "    exists alongside the Keychain item — delete it when you're ready." >&2
    ;;
esac
