# Security: a drive with a known VolumeUUID only ever matches by that UUID

**Date:** 2026-09-01 · **Origin:** appsec audit 2026-09-01, Risk 3 (Low, `identity_spoofing`) · **Status:** approved in conversation 2026-09-01

## Problem

`dp_volumes::resolve_presence` matches registered drives to mounted volumes in
four tiers: (1) `VolumeUUID`, (2) stored `volume_label`, (3) legacy display
name, (4) last known `mount_path`. Tiers 2–4 currently apply **even to a drive
whose row already holds a `volume_uuid`**. So when that drive's real volume is
absent, a *different* physically-attached volume that merely shares its label
(tier 2) or gets its old mount path `/Volumes/<name>` (tier 4) is silently
adopted as that drive.

Consequences of a wrong adoption: a scan ingests the impostor volume's files
into the catalog under the trusted drive's identity, and — worse for an
archive-role drive — organize jobs would **move the user's originals onto the
impostor volume** (the move guards confine writes to the matched volume, but
the matched volume *is* the attacker's). Requires physical attachment of a
crafted volume, hence Low, but the fix is small and strictly safer.

## Design

**Rule: once a drive's row holds a `volume_uuid`, only tier 1 can match it.**
The UUID is the strongest identity we ever recorded for that hardware; label
and mount path are user-renamable/coincidental/spoofable. A uuid-holding drive
is skipped by tiers 2, 3 (already skipped via the `volume_label` gate — a
uuid-holding drive always has a label too, but make the gate explicit anyway),
and 4. No match at tier 1 → reported **unplugged**, never adopted elsewhere.

Legacy drives (`volume_uuid: NULL` — pre-UUID rows, or exFAT/FAT32 volumes
whose UUID `diskutil` can't read) keep today's tier 2–4 behavior: they have no
stronger identity to hold them to, and removing their fallbacks would
permanently orphan them.

### Accepted trade-off

A transient `diskutil` failure (volume mounted but UUID momentarily unreadable)
makes a uuid-holding drive show *unplugged* for that 5s poll tick instead of
matching by label. Fail-safe direction; self-corrects on the next tick that
reads the UUID.

### Interaction with backfill

`should_backfill_identity` (src-tauri/src/presence.rs) only fills NULL columns,
so it never overwrote a stored UUID — but before this change a label-tier
mismatch could backfill a **wrong label** onto a uuid-holding row via the wrong
volume. After this change a uuid-holding drive can only ever match its true
volume, so backfilled values are always the right volume's. No backfill code
change needed.

## Implementation

`crates/dp-volumes/src/presence.rs`:

- In `resolve_presence`, gate tiers 2–4 with `drive.volume_uuid.is_none()`
  (tier 3 keeps its existing `volume_label.is_none()` gate as well).
- Extend the tier doc comment with the security rationale above.

No schema, command, frontend, or event changes — presence output shape is
unchanged.

## Testing (TDD, unit tests in `presence.rs`)

1. uuid-holding drive + mounted volume with **same label, different uuid** →
   unplugged (the impostor scenario).
2. uuid-holding drive + same-label volume with **no readable uuid** → unplugged.
3. uuid-holding drive + volume at its **old mount path**, different/absent
   uuid → unplugged (tier 4 gate).
4. uuid-holding drive + its true uuid present among decoys → still matches
   (existing `uuid_match_beats_a_label_match` keeps passing).
5. Legacy drive (no uuid) with label/name/mount-path matches → unchanged
   (existing tests keep passing).

## Residual risk (issue #34)

`SysinfoVolumes` caches a volume's uuid keyed by mount path and only evicts
entries whose path disappears from the mount set. A same-labeled impostor
attached within one 5s poll tick of the real drive's removal reuses the same
`/Volumes/<name>` path, so the stale cache can report the impostor **with the
real drive's uuid** — matching at tier 1 and bypassing this gate entirely.
Tracked as issue #34 (key the cache on `(mount_path, fsid)` or re-read per
tick); until it lands, this spec's guarantee holds only for swaps slower than
one poll interval.

A reformatted trusted drive (new uuid) now shows unplugged permanently — the
existing `relink_drive` command is the intended, user-consented recovery path.

## Out of scope

- A UI confirmation flow for adopting a look-alike volume ("is this really
  Kodachrome?") — unnecessary once the gate exists; the drive simply shows
  unplugged, which is truthful.
- Recording UUIDs for exFAT/FAT32 volumes some other way (hardware serials) —
  future work if legacy-drive spoofing ever matters in practice.
