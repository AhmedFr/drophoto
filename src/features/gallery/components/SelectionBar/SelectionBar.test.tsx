import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

it("renders nothing when count is 0", () => {
  const { container } = render(<SelectionBar count={0} onTag={() => {}} onClear={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows the selected count", () => {
  render(<SelectionBar count={3} onTag={() => {}} onClear={() => {}} />);
  expect(screen.getByText("3 SELECTED")).toBeInTheDocument();
});

it("calls onTag when the TAG button is clicked", () => {
  const onTag = vi.fn();
  render(<SelectionBar count={2} onTag={onTag} onClear={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "TAG" }));
  expect(onTag).toHaveBeenCalledTimes(1);
});

it("calls onClear when the CLEAR button is clicked", () => {
  const onClear = vi.fn();
  render(<SelectionBar count={2} onTag={() => {}} onClear={onClear} />);
  fireEvent.click(screen.getByRole("button", { name: "CLEAR" }));
  expect(onClear).toHaveBeenCalledTimes(1);
});
