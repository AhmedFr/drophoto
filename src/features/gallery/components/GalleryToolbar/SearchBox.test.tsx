import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import { SearchBox } from "./SearchBox";

beforeEach(() => {
  useGalleryStore.setState({ query: "" });
  useGalleryStore.persist.clearStorage();
});

describe("SearchBox", () => {
  it("shows the Search photos placeholder", () => {
    render(<SearchBox />);
    expect(screen.getByPlaceholderText("Search photos")).toBeInTheDocument();
  });

  it("does not commit to the store on every keystroke", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    render(<SearchBox />);

    await user.type(screen.getByPlaceholderText("Search photos"), "beach");
    expect(useGalleryStore.getState().query).toBe("");

    vi.useRealTimers();
  });

  it("debounces typing into the store's query after 200ms", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    render(<SearchBox />);

    await user.type(screen.getByPlaceholderText("Search photos"), "beach");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(useGalleryStore.getState().query).toBe("beach");
    vi.useRealTimers();
  });

  it("does not refire the debounce on rapid keystrokes within the window", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    render(<SearchBox />);

    const input = screen.getByPlaceholderText("Search photos");
    await user.type(input, "b");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await user.type(input, "e");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // Still within 200ms of the last keystroke — not committed yet.
    expect(useGalleryStore.getState().query).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(useGalleryStore.getState().query).toBe("be");
    vi.useRealTimers();
  });

  it("shows no clear button while empty", () => {
    render(<SearchBox />);
    expect(screen.queryByRole("button", { name: /clear search/i })).not.toBeInTheDocument();
  });

  it("shows a clear button once there's text, and clicking it resets the field and the store immediately", async () => {
    const user = userEvent.setup();
    render(<SearchBox />);

    const input = screen.getByPlaceholderText("Search photos");
    await user.type(input, "beach");
    const clear = await screen.findByRole("button", { name: /clear search/i });

    await user.click(clear);

    expect(input).toHaveValue("");
    expect(useGalleryStore.getState().query).toBe("");
  });

  it("initializes from the store's current query", () => {
    useGalleryStore.setState({ query: "sunset" });
    render(<SearchBox />);
    expect(screen.getByPlaceholderText("Search photos")).toHaveValue("sunset");
  });
});

afterEach(() => {
  vi.useRealTimers();
});
