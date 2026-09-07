import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

function renderBar(overrides: Partial<Parameters<typeof SelectionBar>[0]> = {}) {
  return render(
    <SelectionBar
      count={0}
      total={0}
      onTag={() => {}}
      onPlace={() => {}}
      onClear={() => {}}
      onSelectAll={() => {}}
      onInvert={() => {}}
      {...overrides}
    />,
  );
}

it("renders nothing when count is 0", () => {
  const { container } = renderBar({ count: 0 });
  expect(container).toBeEmptyDOMElement();
});

it("shows the selected count", () => {
  renderBar({ count: 3, total: 5 });
  expect(screen.getByText("3 SELECTED")).toBeInTheDocument();
});

// With paging gone the timeline index covers the whole filtered set, so
// `total` really is every match — but still only within the current
// filter, which is why it reads "IN VIEW" and not "TOTAL".
it("shows the current view's total, labeled as the view rather than the library", () => {
  renderBar({ count: 3, total: 5 });
  expect(screen.getByText("5 IN VIEW")).toBeInTheDocument();
  expect(screen.queryByText(/LOADED/)).not.toBeInTheDocument();
});

it("calls onTag when the TAG button is clicked", () => {
  const onTag = vi.fn();
  renderBar({ count: 2, onTag });
  fireEvent.click(screen.getByRole("button", { name: "TAG" }));
  expect(onTag).toHaveBeenCalledTimes(1);
});

it("calls onPlace when the PLACE button is clicked", () => {
  const onPlace = vi.fn();
  renderBar({ count: 2, onPlace });
  fireEvent.click(screen.getByRole("button", { name: "PLACE" }));
  expect(onPlace).toHaveBeenCalledTimes(1);
});

it("calls onClear when the CLEAR button is clicked", () => {
  const onClear = vi.fn();
  renderBar({ count: 2, onClear });
  fireEvent.click(screen.getByRole("button", { name: "CLEAR" }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

it("calls onSelectAll when the SELECT ALL button is clicked", () => {
  const onSelectAll = vi.fn();
  renderBar({ count: 2, total: 9, onSelectAll });
  fireEvent.click(screen.getByRole("button", { name: "SELECT ALL" }));
  expect(onSelectAll).toHaveBeenCalledTimes(1);
});

it("gives the SELECT ALL button a title scoped to the current view", () => {
  renderBar({ count: 2, total: 9 });
  expect(screen.getByRole("button", { name: "SELECT ALL" })).toHaveAttribute(
    "title",
    "Select all 9 items in this view",
  );
});

it("calls onInvert when the INVERT button is clicked", () => {
  const onInvert = vi.fn();
  renderBar({ count: 2, onInvert });
  fireEvent.click(screen.getByRole("button", { name: "INVERT" }));
  expect(onInvert).toHaveBeenCalledTimes(1);
});
