import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://mock/${path}`),
}));

it("passes the path through to convertFileSrc", async () => {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const { thumbUrl } = await import("./thumbUrl");

  const result = thumbUrl("/Users/x/Library/Application Support/drophoto/thumbs/abc/400.webp");

  expect(convertFileSrc).toHaveBeenCalledWith(
    "/Users/x/Library/Application Support/drophoto/thumbs/abc/400.webp",
  );
  expect(result).toBe("asset://mock//Users/x/Library/Application Support/drophoto/thumbs/abc/400.webp");
});
