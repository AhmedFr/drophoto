#!/bin/sh
# Generates the drophoto updater signing keypair, used to sign release
# artifacts (see scripts/release.sh) and verify them on end-users' machines
# (the public half becomes tauri.conf.json's plugins.updater.pubkey).
#
# The private half ends up ONLY in the login Keychain (service
# drophoto-updater-key) — encrypted at rest, never left as a plaintext file
# (issue #28). The public half stays on disk at …key.pub for release.sh's
# rotation guard.
#
# Idempotent: refuses to overwrite an existing key file OR Keychain item,
# so a re-run can't silently invalidate every already-shipped build's
# ability to verify future updates.
#
# DROPHOTO_KEYCHAIN_SERVICE / DROPHOTO_UPDATER_KEY_PATH are test hooks so
# the flow can be exercised against a throwaway item + key path.
#
# Usage: scripts/updater-keygen.sh
set -eu
SERVICE="${DROPHOTO_KEYCHAIN_SERVICE:-drophoto-updater-key}"
KEY_PATH="${DROPHOTO_UPDATER_KEY_PATH:-$HOME/.tauri/drophoto_updater.key}"
PUB_PATH="$KEY_PATH.pub"
ACCOUNT="$USER"

if [ -f "$KEY_PATH" ]; then
    echo "error: $KEY_PATH already exists — refusing to overwrite it." >&2
    echo "if it's the real signing key, import it with scripts/updater-key-to-keychain.sh" >&2
    echo "instead; only delete it yourself if you really mean to generate a new keypair" >&2
    echo "(every build signed with the old key would then fail to verify)." >&2
    exit 1
fi

if security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
    echo "error: the login Keychain already has a '$SERVICE' item — refusing to generate" >&2
    echo "a second keypair (every build signed with the existing key would fail to verify" >&2
    echo "updates signed by a new one). Delete the Keychain item yourself first if you" >&2
    echo "really mean it." >&2
    exit 1
fi

pnpm tauri signer generate -w "$KEY_PATH"

KEY_CONTENT="$(cat "$KEY_PATH")"
security add-generic-password -s "$SERVICE" -a "$ACCOUNT" -w "$KEY_CONTENT"
READBACK="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)"
if [ "$READBACK" != "$KEY_CONTENT" ]; then
    echo "error: Keychain readback does not match the generated key — keeping $KEY_PATH." >&2
    echo "inspect the '$SERVICE' item in Keychain Access, then migrate the file with" >&2
    echo "scripts/updater-key-to-keychain.sh." >&2
    exit 1
fi
rm "$KEY_PATH"

echo
echo "==> private key imported into the login Keychain (service '$SERVICE');"
echo "    the plaintext file was deleted. To view it for backup:"
echo "    security find-generic-password -s '$SERVICE' -w"
echo
echo "==> public key (paste into src-tauri/tauri.conf.json's plugins.updater.pubkey):"
cat "$PUB_PATH"
echo
echo "==> back the private key up somewhere safe *outside* this machine (a password"
echo "    manager or a separate encrypted volume) — it is never committed, and"
echo "    losing it means every future release has to ship a fresh keypair,"
echo "    breaking auto-update for everyone on the old one."
