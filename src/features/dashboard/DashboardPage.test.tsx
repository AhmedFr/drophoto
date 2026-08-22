import { render, screen } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";

it("renders the Dashboard header", () => {
  render(<DashboardPage />);
  expect(screen.getByRole("heading")).toHaveTextContent("DASHBOARD");
});
