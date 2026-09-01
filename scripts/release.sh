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
# Also one-time: an updater signing keypair (see scripts/updater-keygen.sh)
# — required for every release from here on, since an update the plugin
# can't verify is one it won't install. The private half lives in the login
# Keychain (service drophoto-updater-key, imported by updater-keygen.sh or
# migrated from the old plaintext file by updater-key-to-keychain.sh); only
# the public half stays on disk at ~/.tauri/drophoto_updater.key.pub.
#
# Usage: scripts/release.sh <version>   (must match tauri.conf.json/package.json)
set -eu
VERSION="${1:?usage: scripts/release.sh <version>}"
DMG="target/release/bundle/dmg/drophoto_${VERSION}_aarch64.dmg"
APP="target/release/bundle/macos/drophoto.app"
APP_TARBALL="target/release/bundle/macos/drophoto.app.tar.gz"
APP_SIG="$APP_TARBALL.sig"
LATEST_JSON="target/release/bundle/macos/latest.json"

if ! command -v jq >/dev/null 2>&1; then
    echo "error: jq not found — required to write $LATEST_JSON." >&2
    echo "install it first (e.g. brew install jq)." >&2
    exit 1
fi

# The signing key is read from the login Keychain — never from a plaintext
# file (issue #28: the key gates code delivery to every install and can't
# be rotated, so it must not sit readable in the home directory). A
# still-present plaintext file is a hard error even when the Keychain item
# exists, so the unprotected copy can't quietly linger.
KEYCHAIN_SERVICE="${DROPHOTO_KEYCHAIN_SERVICE:-drophoto-updater-key}"
UPDATER_KEY="${DROPHOTO_UPDATER_KEY_PATH:-$HOME/.tauri/drophoto_updater.key}"
if [ -f "$UPDATER_KEY" ]; then
    echo "error: plaintext signing key found at $UPDATER_KEY." >&2
    echo "run scripts/updater-key-to-keychain.sh to move it into the login Keychain" >&2
    echo "(and let it delete the plaintext file) — release.sh no longer reads key files." >&2
    exit 1
fi
if ! TAURI_SIGNING_PRIVATE_KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$USER" -w 2>/dev/null)"; then
    echo "error: no '$KEYCHAIN_SERVICE' item in the login Keychain (and no key file at $UPDATER_KEY)." >&2
    echo "run scripts/updater-keygen.sh first to generate the updater signing keypair" >&2
    echo "(and put its public half in src-tauri/tauri.conf.json's plugins.updater.pubkey)," >&2
    echo "or restore the key from backup and import it with scripts/updater-key-to-keychain.sh." >&2
    exit 1
fi

CONF_PUBKEY="$(jq -r '.plugins.updater.pubkey' src-tauri/tauri.conf.json)"
if [ "$CONF_PUBKEY" = "UPDATER_PUBKEY_TBD" ]; then
    echo "error: src-tauri/tauri.conf.json's plugins.updater.pubkey is still the UPDATER_PUBKEY_TBD placeholder." >&2
    echo "run scripts/updater-keygen.sh and paste the real pubkey in first — otherwise every" >&2
    echo "installed copy will silently fail to verify this release's updates forever." >&2
    exit 1
fi

if [ -f "$UPDATER_KEY.pub" ] && [ "$CONF_PUBKEY" != "$(cat "$UPDATER_KEY.pub")" ]; then
    echo "error: src-tauri/tauri.conf.json's plugins.updater.pubkey does not match $UPDATER_KEY.pub." >&2
    echo "a rotated key produces the same silent, permanent update failure — fix tauri.conf.json first." >&2
    exit 1
fi

CONF_VERSION="$(jq -r '.version' src-tauri/tauri.conf.json)"
if [ "$VERSION" != "$CONF_VERSION" ]; then
    echo "error: version mismatch: scripts/release.sh was called with $VERSION but" >&2
    echo "src-tauri/tauri.conf.json's version is $CONF_VERSION." >&2
    exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY
# The key material itself is passwordless (tauri has no re-encrypt flow);
# at-rest protection comes from the Keychain, not a passphrase on the blob.
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD

pnpm tauri build

# Checked immediately after build (before the slow notarize/staple round
# trip) so a `bundle.createUpdaterArtifacts` misconfiguration fails fast
# rather than after several minutes of notarization. Nothing downstream
# touches these two files (stapling only rewrites the DMG), so this is the
# only place that needs to check for them.
if [ ! -f "$APP_TARBALL" ] || [ ! -f "$APP_SIG" ]; then
    echo "error: expected updater artifacts missing:" >&2
    echo "  $APP_TARBALL" >&2
    echo "  $APP_SIG" >&2
    echo "(bundle.createUpdaterArtifacts must be true in tauri.conf.json)." >&2
    exit 1
fi

codesign --verify --deep --strict "$APP"
echo "==> notarizing (usually 1-5 minutes)"
xcrun notarytool submit "$DMG" --keychain-profile drophoto-notary --wait
echo "==> stapling"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

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
