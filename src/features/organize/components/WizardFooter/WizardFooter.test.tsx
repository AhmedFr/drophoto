import { screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { WizardFooter } from "./WizardFooter";

function renderFooter(overrides: Partial<Parameters<typeof WizardFooter>[0]> = {}) {
  return renderWithRouter(
    <WizardFooter
      step={0}
      totalSteps={2}
      onBack={vi.fn()}
      primaryLabel="CONTINUE →"
      onPrimary={vi.fn()}
      primaryDisabled={false}
      {...overrides}
    />,
  );
}

it("renders the CANCEL link and step counter", async () => {
  renderFooter();
  expect(await screen.findByRole("link", { name: "CANCEL" })).toHaveAttribute("href", "/");
  expect(screen.getByText("STEP 01 / 02")).toBeInTheDocument();
});

it("hides the BACK button on step 0", async () => {
  renderFooter();
  await screen.findByRole("link", { name: "CANCEL" });
  expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
});

it("shows the BACK button on step 1 and calls onBack when clicked", async () => {
  const onBack = vi.fn();
  renderFooter({ step: 1, onBack });
  fireEvent.click(await screen.findByRole("button", { name: /back/i }));
  expect(onBack).toHaveBeenCalled();
});

it("disables the primary button when primaryDisabled is true", async () => {
  renderFooter({ primaryDisabled: true });
  expect(await screen.findByRole("button", { name: "CONTINUE →" })).toBeDisabled();
});

it("enables the primary button and calls onPrimary when clicked", async () => {
  const onPrimary = vi.fn();
  renderFooter({ primaryDisabled: false, onPrimary });
  const button = await screen.findByRole("button", { name: "CONTINUE →" });
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  expect(onPrimary).toHaveBeenCalled();
});

it("shows STEP 02 / 02 on the second step", async () => {
  renderFooter({ step: 1 });
  expect(await screen.findByText("STEP 02 / 02")).toBeInTheDocument();
});

it("renders the ORGANIZE n label on step 02", async () => {
  renderFooter({ step: 1, primaryLabel: "ORGANIZE 42 →" });
  expect(await screen.findByRole("button", { name: "ORGANIZE 42 →" })).toBeInTheDocument();
});

it("shows the MOVING progress text and a CANCEL button while running, with the primary disabled", async () => {
  const onCancel = vi.fn();
  renderFooter({
    step: 1,
    primaryLabel: "ORGANIZE 42 →",
    primaryDisabled: true,
    running: { done: 12, total: 300, onCancel },
  });

  expect(await screen.findByText("MOVING 12 / 300")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ORGANIZE 42 →" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "CANCEL" }));
  expect(onCancel).toHaveBeenCalled();
});

it("hides the progress text and running CANCEL button when not running", async () => {
  renderFooter({ step: 1, primaryLabel: "ORGANIZE 42 →" });
  expect(screen.queryByText(/MOVING/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "CANCEL" })).not.toBeInTheDocument();
});

it("shows an inline error message when present", async () => {
  renderFooter({ step: 1, error: "a scan job is already running" });
  expect(await screen.findByText("a scan job is already running")).toBeInTheDocument();
});

it("shows a hint when present and there's no error", async () => {
  renderFooter({ step: 1, hint: "Save the rule to apply your changes" });
  expect(await screen.findByText("Save the rule to apply your changes")).toBeInTheDocument();
});

it("prefers the error over the hint when both are present", async () => {
  renderFooter({
    step: 1,
    error: "a scan job is already running",
    hint: "Save the rule to apply your changes",
  });
  expect(await screen.findByText("a scan job is already running")).toBeInTheDocument();
  expect(screen.queryByText("Save the rule to apply your changes")).not.toBeInTheDocument();
});
