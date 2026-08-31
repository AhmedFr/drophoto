import type { Drive } from "@/lib/api/drives";
import type { Volume } from "@/lib/api/volumes";
import { isVolumeClaimedByAnotherDrive } from "./driveIdentity";

function volume(overrides: Partial<Volume> = {}): Volume {
  return {
    name: "T7",
    mount_path: "/Volumes/T7",
    total_bytes: 1_000,
    free_bytes: 500,
    is_removable: true,
    uuid: null,
    ...overrides,
  };
}

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    name: "Some Drive",
    volume_uuid: null,
    volume_label: null,
    mount_path: null,
    role: "archive",
    capacity: 100,
    free: 40,
    last_seen_at: null,
    online: false,
    ...overrides,
  };
}

it("returns false when no drive claims the volume", () => {
  expect(isVolumeClaimedByAnotherDrive(volume(), [drive()])).toBe(false);
});

it("returns true when a drive's volume_uuid matches the volume's uuid", () => {
  const v = volume({ uuid: "uuid-1" });
  const d = drive({ volume_uuid: "uuid-1" });
  expect(isVolumeClaimedByAnotherDrive(v, [d])).toBe(true);
});

it("returns true when a drive's volume_label matches the volume's name", () => {
  const v = volume({ name: "T7" });
  const d = drive({ volume_label: "T7" });
  expect(isVolumeClaimedByAnotherDrive(v, [d])).toBe(true);
});

it("never treats two null uuids as a match", () => {
  const v = volume({ uuid: null });
  const d = drive({ volume_uuid: null });
  expect(isVolumeClaimedByAnotherDrive(v, [d])).toBe(false);
});

it("never treats two null labels as a match", () => {
  const v = volume({ name: "T7" });
  const d = drive({ volume_label: null });
  expect(isVolumeClaimedByAnotherDrive(v, [d])).toBe(false);
});

it("returns false for an empty drives list", () => {
  expect(isVolumeClaimedByAnotherDrive(volume(), [])).toBe(false);
});
