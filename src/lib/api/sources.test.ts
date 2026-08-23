import { mockIPC } from "@tauri-apps/api/mocks";
import { detectSources, listSources, saveSources, setSourceEnabled } from "./sources";
import { ApiError } from "./client";

it("detects sources for a drive", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "detect_sources") {
      received = args;
      return [{ rel_path: "DCIM", media_count: 42, bytes: 1024, suggested: true }];
    }
    return undefined;
  });
  await expect(detectSources(1)).resolves.toEqual([
    { rel_path: "DCIM", media_count: 42, bytes: 1024, suggested: true },
  ]);
  expect(received).toEqual({ driveId: 1 });
});

it("wraps structured errors from detect_sources", async () => {
  mockIPC(() => {
    throw { code: "not_found", message: "drive is offline" };
  });
  await expect(detectSources(1)).rejects.toBeInstanceOf(ApiError);
});

it("lists sources for a drive", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_sources") {
      received = args;
      return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    }
    return undefined;
  });
  await expect(listSources(1)).resolves.toEqual([{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }]);
  expect(received).toEqual({ driveId: 1 });
});

it("saves the source set with the given drive id and rel paths", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "save_sources") {
      received = args;
      return null;
    }
    return undefined;
  });
  await saveSources(1, ["DCIM", "Pictures"]);
  expect(received).toEqual({ driveId: 1, relPaths: ["DCIM", "Pictures"] });
});

it("sets a source's enabled state", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "set_source_enabled") {
      received = args;
      return null;
    }
    return undefined;
  });
  await setSourceEnabled(3, false);
  expect(received).toEqual({ sourceId: 3, enabled: false });
});
