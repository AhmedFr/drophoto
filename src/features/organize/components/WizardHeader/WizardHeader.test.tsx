import { render, screen } from "@testing-library/react";
import { WizardHeader } from "./WizardHeader";

it("renders the eyebrow and title", () => {
  render(<WizardHeader eyebrow="STEP 01 · DETECT" title="New photos found" />);
  expect(screen.getByText("STEP 01 · DETECT")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "New photos found" })).toBeInTheDocument();
});

it("renders the note when given", () => {
  render(<WizardHeader eyebrow="STEP 01 · DETECT" title="New photos found" note="Nothing leaves this device." />);
  expect(screen.getByText("Nothing leaves this device.")).toBeInTheDocument();
});

it("renders no note text when omitted", () => {
  const { container } = render(<WizardHeader eyebrow="STEP 01 · DETECT" title="New photos found" />);
  expect(container.querySelector("p")).not.toBeInTheDocument();
});
