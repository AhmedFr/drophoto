import { mockIPC } from "@tauri-apps/api/mocks";
import { listVolumes } from "./volumes";
import { ApiError } from "./client";

it("returns volumes from the backend", async () => {
  mockIPC((cmd) =>
    cmd === "list_volumes"
      ? [
          {
            name: "Kodachrome",
            mount_path: "/Volumes/Kodachrome",
            total_bytes: 10,
            free_bytes: 5,
            is_removable: true,
            uuid: null,
          },
        ]
      : undefined,
  );
  await expect(listVolumes()).resolves.toHaveLength(1);
});

it("wraps structured errors", async () => {
  mockIPC(() => {
    throw { code: "io", message: "boom" };
  });
  await expect(listVolumes()).rejects.toBeInstanceOf(ApiError);
});
