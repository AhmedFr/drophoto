import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KindChips } from "./KindChips";

it("renders a chip for every kind filter with the current value active", () => {
  render(<KindChips value="ALL" onChange={() => {}} />);
  expect(screen.getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "PHOTOS" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "VIDEOS" })).toHaveAttribute("aria-pressed", "false");
});

it("calls onChange with the clicked filter", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<KindChips value="ALL" onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "VIDEOS" }));

  expect(onChange).toHaveBeenCalledWith("VIDEOS");
});

it("reflects a non-ALL value passed in as active", () => {
  render(<KindChips value="PHOTOS" onChange={() => {}} />);
  expect(screen.getByRole("button", { name: "PHOTOS" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "false");
});
