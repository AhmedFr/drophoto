import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./SearchInput";

it("shows the placeholder and is focused on mount", () => {
  render(<SearchInput value="" onChange={() => {}} />);
  const input = screen.getByPlaceholderText("Search file names, tags, cameras…");
  expect(input).toHaveFocus();
});

it("reflects the current value", () => {
  render(<SearchInput value="beach" onChange={() => {}} />);
  expect(screen.getByRole("textbox")).toHaveValue("beach");
});

it("calls onChange as the user types", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<SearchInput value="" onChange={onChange} />);

  await user.type(screen.getByRole("textbox"), "hi");

  expect(onChange).toHaveBeenCalledWith("h");
  expect(onChange).toHaveBeenCalledWith("i");
});
