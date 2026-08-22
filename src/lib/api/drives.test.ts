import { mockIPC } from "@tauri-apps/api/mocks";
import { registerDrive, listDrives } from "./drives";
import { ApiError } from "./client";
import type { Drive } from "./drives";

const drive: Drive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
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
