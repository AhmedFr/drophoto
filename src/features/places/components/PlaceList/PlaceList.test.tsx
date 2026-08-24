import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { PlaceCount } from "@/lib/api/places";
import { PlaceList } from "./PlaceList";

function pc(id: number, name: string, country: string): PlaceCount {
  return {
    place: { id, lat: 1, lon: 2, name, admin: null, country, source: "geocoder" },
    count: id * 10,
  };
}

it("groups places by country, sorted alphabetically within each group", () => {
  render(
    <PlaceList
      placeCounts={[pc(1, "Porto", "Portugal"), pc(2, "Faro", "Portugal"), pc(3, "Paris", "France")]}
      onSelectPlace={() => {}}
    />,
  );

  const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual(["FRANCE", "PORTUGAL"]);

  // Within Portugal, Faro (id 2) should render before Porto (id 1).
  const faroIndex = screen.getByText("Faro").compareDocumentPosition(screen.getByText("Porto"));
  // Node.DOCUMENT_POSITION_FOLLOWING === 4 means "Porto" comes after "Faro".
  expect(faroIndex & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("shows each place's count and admin when present", () => {
  render(
    <PlaceList
      placeCounts={[
        { place: { id: 1, lat: 1, lon: 2, name: "Lisbon", admin: "Lisboa", country: "Portugal", source: "geocoder" }, count: 5 },
      ]}
      onSelectPlace={() => {}}
    />,
  );

  expect(screen.getByText("Lisbon, Lisboa")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
});

it("calls onSelectPlace with the place id when a row is clicked", () => {
  const onSelectPlace = vi.fn();
  render(<PlaceList placeCounts={[pc(7, "Faro", "Portugal")]} onSelectPlace={onSelectPlace} />);

  fireEvent.click(screen.getByText("Faro"));

  expect(onSelectPlace).toHaveBeenCalledWith(7);
});

it("renders nothing (no groups) for an empty list", () => {
  render(<PlaceList placeCounts={[]} onSelectPlace={() => {}} />);
  expect(within(screen.getByTestId("place-list")).queryAllByRole("heading")).toHaveLength(0);
});
