import { waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { toast } from "sonner";
import { renderWithRouter } from "@/test/renderWithRouter";
import { checkForUpdate } from "@/lib/api/updater";
import { UpdateNotifier } from "./UpdateNotifier";

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock("@/lib/api/updater", () => ({ checkForUpdate: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  vi.mocked(checkForUpdate).mockReset();
  vi.mocked(toast).mockClear();
  navigateSpy.mockClear();
});

it("renders nothing", () => {
  vi.mocked(checkForUpdate).mockResolvedValue(null);
  const { container } = renderWithRouter(<UpdateNotifier />);
  expect(container).toBeEmptyDOMElement();
});

it("checks for an update exactly once on mount", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue(null);
  renderWithRouter(<UpdateNotifier />);
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
});

it("does not toast when already up to date", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue(null);
  renderWithRouter(<UpdateNotifier />);
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
  expect(toast).not.toHaveBeenCalled();
});

it("does not toast or throw when the check itself fails (e.g. the placeholder pubkey)", async () => {
  vi.mocked(checkForUpdate).mockRejectedValue(new Error("signature is not valid"));
  renderWithRouter(<UpdateNotifier />);
  await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
  expect(toast).not.toHaveBeenCalled();
});

it("toasts exactly once with the version when an update is available", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue({ version: "0.4.0", notes: null });
  renderWithRouter(<UpdateNotifier />);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(toast).toHaveBeenCalledWith(
    "Update available — v0.4.0",
    expect.objectContaining({ action: expect.objectContaining({ label: "View" }) }),
  );
});

it("navigates to /settings when the toast's action is clicked", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue({ version: "0.4.0", notes: null });
  renderWithRouter(<UpdateNotifier />);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

  const options = vi.mocked(toast).mock.calls[0][1] as unknown as { action: { onClick: () => void } };
  options.action.onClick();

  expect(navigateSpy).toHaveBeenCalledWith({ to: "/settings" });
});
