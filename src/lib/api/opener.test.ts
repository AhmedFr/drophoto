import { vi } from "vitest";
import { revealInFinder } from "./opener";

vi.mock("@tauri-apps/plugin-opener");

it("passes the path through to revealItemInDir", async () => {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  vi.mocked(revealItemInDir).mockResolvedValue(undefined);

  await revealInFinder("/Volumes/Kodachrome/photos/1.jpg");

  expect(revealItemInDir).toHaveBeenCalledWith("/Volumes/Kodachrome/photos/1.jpg");
});
