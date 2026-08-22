import { render, screen } from "@testing-library/react";
import { SearchPage } from "./SearchPage";

it("renders the Search header", () => {
  render(<SearchPage />);
  expect(screen.getByRole("heading")).toHaveTextContent("SEARCH");
});
