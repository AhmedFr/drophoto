import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

it("renders the Settings header", () => {
  render(<SettingsPage />);
  expect(screen.getByRole("heading")).toHaveTextContent("SETTINGS");
});
