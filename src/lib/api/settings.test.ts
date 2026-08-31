import { mockIPC } from "@tauri-apps/api/mocks";
import {
  getSettings,
  resetAppData,
  setPreviewQuality,
  startRegenPreviews,
  storageUsage,
  PREVIEW_EDGES,
} from "./settings";
import { ApiError } from "./client";
import type { AppSettings, StorageUsage } from "./settings";

it("gets current settings with no arguments", async () => {
  const settings: AppSettings = { preview_edge: PREVIEW_EDGES.max };
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "get_settings") {
      received = args;
      return settings;
    }
    return undefined;
  });
  await expect(getSettings()).resolves.toEqual(settings);
  expect(received).toEqual({});
});

it("wraps structured errors from get_settings", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(getSettings()).rejects.toBeInstanceOf(ApiError);
});

it("sets the preview quality edge, round-tripping the value", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "set_preview_quality") {
      received = args;
      return null;
    }
    return undefined;
  });
  await setPreviewQuality(PREVIEW_EDGES.compact);
  expect(received).toEqual({ edge: PREVIEW_EDGES.compact });
});

it("wraps structured errors from set_preview_quality", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(setPreviewQuality(PREVIEW_EDGES.compact)).rejects.toBeInstanceOf(ApiError);
});

it("wraps the command's rejection of an off-step edge", async () => {
  mockIPC(() => {
    throw { code: "unsupported", message: "invalid preview quality edge 999; must be one of [800, 1200, 2000]" };
  });
  await expect(setPreviewQuality(999)).rejects.toBeInstanceOf(ApiError);
});

it("gets storage usage with no arguments", async () => {
  const usage: StorageUsage = {
    thumbs_400_bytes: 1000,
    previews_bytes: 9000,
    catalog_bytes: 500,
    total_bytes: 10500,
    file_count: 12,
  };
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "storage_usage") {
      received = args;
      return usage;
    }
    return undefined;
  });
  await expect(storageUsage()).resolves.toEqual(usage);
  expect(received).toEqual({});
});

it("wraps structured errors from storage_usage", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(storageUsage()).rejects.toBeInstanceOf(ApiError);
});

it("starts a regen sweep with no arguments and returns the started job id", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_regen_previews") {
      received = args;
      return "regen-0";
    }
    return undefined;
  });
  await expect(startRegenPreviews()).resolves.toBe("regen-0");
  expect(received).toEqual({});
});

it("wraps structured errors from start_regen_previews", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(startRegenPreviews()).rejects.toBeInstanceOf(ApiError);
});

it("calls reset_app_data with no arguments", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "reset_app_data") {
      received = args;
      return null;
    }
    return undefined;
  });
  await resetAppData();
  expect(received).toEqual({});
});

it("wraps structured errors from reset_app_data", async () => {
  mockIPC(() => {
    throw { code: "io", message: "boom" };
  });
  await expect(resetAppData()).rejects.toBeInstanceOf(ApiError);
});
