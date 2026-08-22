import { render, screen } from "@testing-library/react";
import { OrganizePage } from "./OrganizePage";

it("renders the Organize header", () => {
  render(<OrganizePage />);
  expect(screen.getByRole("heading")).toHaveTextContent("ORGANIZE");
});
