import { mockIPC } from "@tauri-apps/api/mocks";
import { rebuildFts } from "./search";
import { ApiError } from "./client";

it("rebuilds the FTS index with no arguments", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "rebuild_fts") {
      received = args;
      return null;
    }
    return undefined;
  });

  await rebuildFts();
  expect(received).toEqual({});
});

it("wraps structured errors from rebuild_fts", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(rebuildFts()).rejects.toBeInstanceOf(ApiError);
});
