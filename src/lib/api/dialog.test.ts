import { vi } from "vitest";
import { pickFolder } from "./dialog";

vi.mock("@tauri-apps/plugin-dialog");

it("returns the chosen path", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("/Volumes/Kodachrome/DCIM");

  await expect(pickFolder("/Volumes/Kodachrome")).resolves.toBe("/Volumes/Kodachrome/DCIM");
  expect(open).toHaveBeenCalledWith({
    directory: true,
    multiple: false,
    defaultPath: "/Volumes/Kodachrome",
  });
});

it("returns null when the user cancels", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);

  await expect(pickFolder()).resolves.toBeNull();
});
