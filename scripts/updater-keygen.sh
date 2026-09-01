#!/bin/sh
# Generates the drophoto updater signing keypair, used to sign release
# artifacts (see scripts/release.sh) and verify them on end-users' machines
# (the public half becomes tauri.conf.json's plugins.updater.pubkey).
#
# Idempotent: refuses to overwrite an existing key so a re-run can't
# silently invalidate every already-shipped build's ability to verify
# future updates.
#
# Usage: scripts/updater-keygen.sh
set -eu
KEY_PATH="$HOME/.tauri/drophoto_updater.key"
PUB_PATH="$KEY_PATH.pub"

if [ -f "$KEY_PATH" ]; then
    echo "error: $KEY_PATH already exists — refusing to overwrite it." >&2
    echo "delete it yourself first if you really mean to generate a new keypair" >&2
    echo "(every build signed with the old key would then fail to verify)." >&2
    exit 1
fi

pnpm tauri signer generate -w "$KEY_PATH"

echo
echo "==> public key (paste into src-tauri/tauri.conf.json's plugins.updater.pubkey):"
cat "$PUB_PATH"
echo
echo "==> back up $KEY_PATH somewhere safe *outside* this repo (a password"
echo "    manager or a separate encrypted volume) — it is never committed,"
echo "    and losing it means every future release has to ship a fresh"
echo "    keypair, breaking auto-update for everyone on the old one."
