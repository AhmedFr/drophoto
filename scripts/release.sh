#!/bin/sh
# Build, sign, notarize, staple and publish a drophoto release — including
# the updater artifacts (.app.tar.gz + .sig + latest.json) that let
# already-installed copies update in place via tauri-plugin-updater.
#
# One-time setup (interactive, stores an app-specific password in the
# login keychain — create one at https://account.apple.com > Sign-In and
# Security > App-Specific Passwords):
#
#   xcrun notarytool store-credentials drophoto-notary \
#     --apple-id <your-apple-id-email> --team-id 82S6RGN448
#
# Also one-time: an updater signing keypair at ~/.tauri/drophoto_updater.key
# (see scripts/updater-keygen.sh) — required for every release from here on,
# since an update the plugin can't verify is one it won't install.
#
# Usage: scripts/release.sh <version>   (must match tauri.conf.json/package.json)
set -eu
VERSION="${1:?usage: scripts/release.sh <version>}"
DMG="target/release/bundle/dmg/drophoto_${VERSION}_aarch64.dmg"
APP="target/release/bundle/macos/drophoto.app"
APP_TARBALL="target/release/bundle/macos/drophoto.app.tar.gz"
APP_SIG="$APP_TARBALL.sig"
LATEST_JSON="target/release/bundle/macos/latest.json"

UPDATER_KEY="$HOME/.tauri/drophoto_updater.key"
if [ ! -f "$UPDATER_KEY" ]; then
    echo "error: $UPDATER_KEY not found." >&2
    echo "run scripts/updater-keygen.sh first to generate the updater signing keypair" >&2
    echo "(and put its public half in src-tauri/tauri.conf.json's plugins.updater.pubkey)." >&2
    exit 1
fi

TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"
export TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD

pnpm tauri build

codesign --verify --deep --strict "$APP"
echo "==> notarizing (usually 1-5 minutes)"
xcrun notarytool submit "$DMG" --keychain-profile drophoto-notary --wait
echo "==> stapling"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

if [ ! -f "$APP_TARBALL" ] || [ ! -f "$APP_SIG" ]; then
    echo "error: expected updater artifacts missing:" >&2
    echo "  $APP_TARBALL" >&2
    echo "  $APP_SIG" >&2
    echo "(bundle.createUpdaterArtifacts must be true in tauri.conf.json)." >&2
    exit 1
fi

echo "==> writing $LATEST_JSON"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SIGNATURE="$(cat "$APP_SIG")"
jq -n \
    --arg version "$VERSION" \
    --arg pub_date "$PUB_DATE" \
    --arg url "https://github.com/AhmedFr/drophoto/releases/download/v${VERSION}/drophoto.app.tar.gz" \
    --arg signature "$SIGNATURE" \
    '{version: $version, pub_date: $pub_date, platforms: {"darwin-aarch64": {url: $url, signature: $signature}}}' \
    >"$LATEST_JSON"

echo "==> uploading to release v$VERSION"
gh release upload "v$VERSION" "$DMG" "$APP_TARBALL" "$LATEST_JSON" --clobber
echo "done: https://github.com/AhmedFr/drophoto/releases/tag/v$VERSION"
