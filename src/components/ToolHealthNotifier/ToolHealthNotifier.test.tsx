import { waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { toast } from "sonner";
import { renderWithRouter } from "@/test/renderWithRouter";
import { toolHealth, type ToolHealth, type ToolStatus } from "@/lib/api/settings";
import { ToolHealthNotifier } from "./ToolHealthNotifier";

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock("@/lib/api/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/settings")>("@/lib/api/settings");
  return { ...actual, toolHealth: vi.fn() };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

const current = (path: string): ToolStatus => ({ path, version: "99.0", outdated: false });
const outdated = (path: string, version: string): ToolStatus => ({ path, version, outdated: true });
const health = (exiftool: ToolStatus, ffmpeg: ToolStatus): ToolHealth => ({ exiftool, ffmpeg });

beforeEach(() => {
  vi.mocked(toolHealth).mockReset();
  vi.mocked(toast.warning).mockClear();
  navigateSpy.mockClear();
});

it("renders nothing", () => {
  vi.mocked(toolHealth).mockResolvedValue(health(current("/a"), current("/b")));
  const { container } = renderWithRouter(<ToolHealthNotifier />);
  expect(container).toBeEmptyDOMElement();
});

it("does not toast when every tool is current or missing", async () => {
  vi.mocked(toolHealth).mockResolvedValue(
    health(current("/a"), { path: null, version: null, outdated: false }),
  );
  renderWithRouter(<ToolHealthNotifier />);
  await waitFor(() => expect(toolHealth).toHaveBeenCalledTimes(1));
  expect(toast.warning).not.toHaveBeenCalled();
});

it("does not toast or throw when the query itself fails", async () => {
  vi.mocked(toolHealth).mockRejectedValue(new Error("boom"));
  renderWithRouter(<ToolHealthNotifier />);
  await waitFor(() => expect(toolHealth).toHaveBeenCalledTimes(1));
  expect(toast.warning).not.toHaveBeenCalled();
});

it("toasts exactly once naming the outdated tool and its version", async () => {
  vi.mocked(toolHealth).mockResolvedValue(health(outdated("/a", "12.10"), current("/b")));
  renderWithRouter(<ToolHealthNotifier />);
  await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
  expect(toast.warning).toHaveBeenCalledWith(
    "exiftool 12.10 is outdated and unsafe on untrusted files — see Settings → Tools",
    expect.objectContaining({ action: expect.objectContaining({ label: "View" }) }),
  );
});

it("names both tools in one toast when both are outdated", async () => {
  vi.mocked(toolHealth).mockResolvedValue(health(outdated("/a", "12.10"), outdated("/b", "4.4")));
  renderWithRouter(<ToolHealthNotifier />);
  await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
  expect(toast.warning).toHaveBeenCalledWith(
    "exiftool 12.10 and ffmpeg 4.4 are outdated and unsafe on untrusted files — see Settings → Tools",
    expect.objectContaining({ action: expect.objectContaining({ label: "View" }) }),
  );
});

it("navigates to /settings when the toast's action is clicked", async () => {
  vi.mocked(toolHealth).mockResolvedValue(health(outdated("/a", "12.10"), current("/b")));
  renderWithRouter(<ToolHealthNotifier />);
  await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

  const options = vi.mocked(toast.warning).mock.calls[0][1] as unknown as { action: { onClick: () => void } };
  options.action.onClick();

  expect(navigateSpy).toHaveBeenCalledWith({ to: "/settings" });
});
