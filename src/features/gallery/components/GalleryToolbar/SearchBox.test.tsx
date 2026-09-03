import { act, fireEvent, render, screen } from "@testing-library/react";
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

  // These three drive the input with `fireEvent.change` rather than
  // `userEvent.type`: user-event's async pointer/keyboard machinery
  // deadlocks against `vi.useFakeTimers()` in this setup (its internal
  // waits never resolve because nothing advances the clock between
  // keystrokes), which hung the suite for 5s per test. `fireEvent` is
  // synchronous and dispatches exactly the `change` event the debounce
  // listens to, so the timing under test stays the real subject.
  it("does not commit to the store on every keystroke", () => {
    vi.useFakeTimers();
    render(<SearchBox />);

    fireEvent.change(screen.getByPlaceholderText("Search photos"), { target: { value: "beach" } });

    expect(useGalleryStore.getState().query).toBe("");
  });

  it("debounces typing into the store's query after 200ms", () => {
    vi.useFakeTimers();
    render(<SearchBox />);

    fireEvent.change(screen.getByPlaceholderText("Search photos"), { target: { value: "beach" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(useGalleryStore.getState().query).toBe("beach");
  });

  it("does not refire the debounce on rapid keystrokes within the window", () => {
    vi.useFakeTimers();
    render(<SearchBox />);

    const input = screen.getByPlaceholderText("Search photos");
    fireEvent.change(input, { target: { value: "b" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "be" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Still within 200ms of the last keystroke — not committed yet.
    expect(useGalleryStore.getState().query).toBe("");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(useGalleryStore.getState().query).toBe("be");
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
