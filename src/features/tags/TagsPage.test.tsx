import { render, screen } from "@testing-library/react";
import { TagsPage } from "./TagsPage";

it("renders the Tags header", () => {
  render(<TagsPage />);
  expect(screen.getByRole("heading")).toHaveTextContent("TAGS");
});
