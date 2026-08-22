import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import { SortMenu } from "./SortMenu";

beforeEach(() => {
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
  useGalleryStore.persist.clearStorage();
});

describe("SortMenu", () => {
  it("shows the current sort on the trigger", () => {
    render(<SortMenu />);
    expect(screen.getByRole("button", { name: /NEWEST/ })).toBeInTheDocument();
  });

  it("opening the menu and choosing OLDEST updates the store", async () => {
    const user = userEvent.setup();
    render(<SortMenu />);

    await user.click(screen.getByRole("button", { name: /NEWEST/ }));
    await user.click(await screen.findByRole("menuitem", { name: "OLDEST" }));

    expect(useGalleryStore.getState().sort).toBe("OLDEST");
    expect(await screen.findByRole("button", { name: /OLDEST/ })).toBeInTheDocument();
  });
});
