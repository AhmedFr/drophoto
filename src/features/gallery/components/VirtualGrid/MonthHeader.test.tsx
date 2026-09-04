import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MonthHeader } from "./MonthHeader";

it("renders the label and count", () => {
  render(<MonthHeader label="September 2026" count={12} ids={[1, 2, 3]} onSelect={() => {}} />);
  expect(screen.getByText("September 2026")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
});

it("exposes a select action with a descriptive aria-label", () => {
  render(<MonthHeader label="September 2026" count={12} ids={[1, 2, 3]} onSelect={() => {}} />);
  expect(
    screen.getByRole("button", { name: "Select all 12 in September 2026" }),
  ).toBeInTheDocument();
});

it("calls onSelect with this month's ids and additive=false on a plain click", () => {
  const onSelect = vi.fn();
  render(<MonthHeader label="September 2026" count={3} ids={[1, 2, 3]} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /select all/i }));
  expect(onSelect).toHaveBeenCalledWith([1, 2, 3], false);
});

it("calls onSelect with additive=true on a cmd-click", () => {
  const onSelect = vi.fn();
  render(<MonthHeader label="September 2026" count={3} ids={[1, 2, 3]} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /select all/i }), { metaKey: true });
  expect(onSelect).toHaveBeenCalledWith([1, 2, 3], true);
});

it("calls onSelect with additive=true on a ctrl-click", () => {
  const onSelect = vi.fn();
  render(<MonthHeader label="September 2026" count={3} ids={[1, 2, 3]} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /select all/i }), { ctrlKey: true });
  expect(onSelect).toHaveBeenCalledWith([1, 2, 3], true);
});
