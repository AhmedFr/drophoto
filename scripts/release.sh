#!/bin/sh
# Build, sign, notarize, staple and publish a drophoto release.
#
# One-time setup (interactive, stores an app-specific password in the
# login keychain — create one at https://account.apple.com > Sign-In and
# Security > App-Specific Passwords):
#
#   xcrun notarytool store-credentials drophoto-notary \
#     --apple-id <your-apple-id-email> --team-id 82S6RGN448
#
# Usage: scripts/release.sh <version>   (must match tauri.conf.json/package.json)
set -eu
VERSION="${1:?usage: scripts/release.sh <version>}"
DMG="target/release/bundle/dmg/drophoto_${VERSION}_aarch64.dmg"
APP="target/release/bundle/macos/drophoto.app"

pnpm tauri build

codesign --verify --deep --strict "$APP"
echo "==> notarizing (usually 1-5 minutes)"
xcrun notarytool submit "$DMG" --keychain-profile drophoto-notary --wait
echo "==> stapling"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "==> uploading to release v$VERSION"
gh release upload "v$VERSION" "$DMG" --clobber
echo "done: https://github.com/AhmedFr/drophoto/releases/tag/v$VERSION"
