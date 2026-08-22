import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

it("renders sidebar and children", () => {
  render(
    <AppShell sidebar={<div>S</div>}>
      <p>C</p>
    </AppShell>,
  );
  expect(screen.getByText("S")).toBeInTheDocument();
  expect(screen.getByText("C")).toBeInTheDocument();
});
