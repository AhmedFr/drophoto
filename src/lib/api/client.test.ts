import { mockIPC } from "@tauri-apps/api/mocks";
import { invokeApi } from "./client";

it("rethrows non-structured errors as-is", async () => {
  mockIPC(() => {
    throw new Error("x");
  });
  await expect(invokeApi("some_cmd")).rejects.toThrow("x");
});
