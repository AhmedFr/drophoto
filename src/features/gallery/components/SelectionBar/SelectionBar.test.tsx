import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

it("renders nothing when count is 0", () => {
  const { container } = render(
    <SelectionBar count={0} onTag={() => {}} onPlace={() => {}} onClear={() => {}} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("shows the selected count", () => {
  render(<SelectionBar count={3} onTag={() => {}} onPlace={() => {}} onClear={() => {}} />);
  expect(screen.getByText("3 SELECTED")).toBeInTheDocument();
});

it("calls onTag when the TAG button is clicked", () => {
  const onTag = vi.fn();
  render(<SelectionBar count={2} onTag={onTag} onPlace={() => {}} onClear={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "TAG" }));
  expect(onTag).toHaveBeenCalledTimes(1);
});

it("calls onPlace when the PLACE button is clicked", () => {
  const onPlace = vi.fn();
  render(<SelectionBar count={2} onTag={() => {}} onPlace={onPlace} onClear={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "PLACE" }));
  expect(onPlace).toHaveBeenCalledTimes(1);
});

it("calls onClear when the CLEAR button is clicked", () => {
  const onClear = vi.fn();
  render(<SelectionBar count={2} onTag={() => {}} onPlace={() => {}} onClear={onClear} />);
  fireEvent.click(screen.getByRole("button", { name: "CLEAR" }));
  expect(onClear).toHaveBeenCalledTimes(1);
});
