import { mockIPC } from "@tauri-apps/api/mocks";
import { registerDrive, listDrives, forgetDrive, countDriveMedia } from "./drives";
import { ApiError } from "./client";
import type { Drive } from "./drives";

const drive: Drive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  volume_label: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive",
  capacity: 100,
  free: 40,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

it("registers a drive with the given input", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "register_drive") {
      received = (args as { input?: unknown } | undefined)?.input;
      return drive;
    }
    return undefined;
  });
  const result = await registerDrive({
    name: "Kodachrome",
    mount_path: "/Volumes/Kodachrome",
    role: "archive",
    capacity: 100,
    free: 40,
  });
  expect(result).toEqual(drive);
  expect(received).toEqual({
    name: "Kodachrome",
    mount_path: "/Volumes/Kodachrome",
    role: "archive",
    capacity: 100,
    free: 40,
  });
});

it("lists drives from the backend", async () => {
  mockIPC((cmd) => (cmd === "list_drives" ? [drive] : undefined));
  await expect(listDrives()).resolves.toEqual([drive]);
});

it("wraps structured errors", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(listDrives()).rejects.toBeInstanceOf(ApiError);
});

it("passes volume_uuid and volume_label through to the backend when given", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "register_drive") {
      received = (args as { input?: unknown } | undefined)?.input;
      return drive;
    }
    return undefined;
  });
  await registerDrive({
    name: "Kodachrome",
    mount_path: "/Volumes/Kodachrome",
    role: "archive",
    capacity: 100,
    free: 40,
    volume_uuid: "uuid-1",
    volume_label: "Kodachrome",
  });
  expect(received).toEqual(
    expect.objectContaining({ volume_uuid: "uuid-1", volume_label: "Kodachrome" }),
  );
});

it("forgets a drive by id", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "forget_drive") {
      received = args;
      return undefined;
    }
    return undefined;
  });
  await forgetDrive(7);
  expect(received).toEqual({ driveId: 7 });
});

it("counts a drive's media", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "count_drive_media") {
      expect(args).toEqual({ driveId: 7 });
      return 42;
    }
    return undefined;
  });
  await expect(countDriveMedia(7)).resolves.toBe(42);
});
