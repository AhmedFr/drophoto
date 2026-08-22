import { render, screen } from "@testing-library/react";
import { StepRail } from "./StepRail";

it("renders the Organize title and both step names", () => {
  render(<StepRail step={0} selectedCount={0} selectedBytes={0} />);
  expect(screen.getByRole("heading", { name: "Organize" })).toBeInTheDocument();
  expect(screen.getByText("Detect")).toBeInTheDocument();
  expect(screen.getAllByText("Organize")).toHaveLength(2);
});

it("marks step 0 as active with the number shown", () => {
  render(<StepRail step={0} selectedCount={0} selectedBytes={0} />);
  expect(screen.getByText("01")).toBeInTheDocument();
});

it("marks the prior step as done with a checkmark once past it", () => {
  render(<StepRail step={1} selectedCount={0} selectedBytes={0} />);
  expect(screen.getByText("✓")).toBeInTheDocument();
});

it("shows the selected count and formatted size", () => {
  render(<StepRail step={0} selectedCount={3} selectedBytes={2_000_000} />);
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("1.9 MB")).toBeInTheDocument();
});

it("shows the local-only lock line", () => {
  render(<StepRail step={0} selectedCount={0} selectedBytes={0} />);
  expect(screen.getByText("RUNS LOCALLY · NOTHING LEAVES THIS COMPUTER")).toBeInTheDocument();
});
