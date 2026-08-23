import { render, screen } from "@testing-library/react";
import { DotLoader } from "./DotLoader";

it("renders with role=status", () => {
  render(<DotLoader label="Scanning…" />);
  expect(screen.getByRole("status")).toBeInTheDocument();
});

it("shows the label text next to the loader", () => {
  render(<DotLoader label="Looking for photo folders…" />);
  expect(screen.getByText("Looking for photo folders…")).toBeInTheDocument();
});

it("uses the label as the accessible name when given", () => {
  render(<DotLoader label="Scanning…" />);
  expect(screen.getByRole("status")).toHaveAccessibleName("Scanning…");
});

it("renders without a label", () => {
  render(<DotLoader />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAccessibleName("Loading");
});

it("renders 25 dots in the grid", () => {
  const { container } = render(<DotLoader />);
  expect(container.querySelectorAll("circle")).toHaveLength(25);
});
