import { screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { WizardFooter } from "./WizardFooter";

it("renders the CANCEL link and step counter", async () => {
  renderWithRouter(
    <WizardFooter step={0} totalSteps={2} canContinue={false} onBack={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(await screen.findByRole("link", { name: "CANCEL" })).toHaveAttribute("href", "/");
  expect(screen.getByText("STEP 01 / 02")).toBeInTheDocument();
});

it("hides the BACK button on step 0", async () => {
  renderWithRouter(
    <WizardFooter step={0} totalSteps={2} canContinue={false} onBack={vi.fn()} onContinue={vi.fn()} />,
  );
  await screen.findByRole("link", { name: "CANCEL" });
  expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
});

it("shows the BACK button on step 1 and calls onBack when clicked", async () => {
  const onBack = vi.fn();
  renderWithRouter(
    <WizardFooter step={1} totalSteps={2} canContinue={false} onBack={onBack} onContinue={vi.fn()} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /back/i }));
  expect(onBack).toHaveBeenCalled();
});

it("disables CONTINUE when canContinue is false", async () => {
  renderWithRouter(
    <WizardFooter step={0} totalSteps={2} canContinue={false} onBack={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(await screen.findByRole("button", { name: /continue/i })).toBeDisabled();
});

it("enables CONTINUE and calls onContinue when canContinue is true", async () => {
  const onContinue = vi.fn();
  renderWithRouter(
    <WizardFooter step={0} totalSteps={2} canContinue={true} onBack={vi.fn()} onContinue={onContinue} />,
  );
  const button = await screen.findByRole("button", { name: /continue/i });
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  expect(onContinue).toHaveBeenCalled();
});

it("shows STEP 02 / 02 on the second step", async () => {
  renderWithRouter(
    <WizardFooter step={1} totalSteps={2} canContinue={false} onBack={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(await screen.findByText("STEP 02 / 02")).toBeInTheDocument();
});
