import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { UpdatesSection } from "./UpdatesSection";
import type { UpdatesSectionProps } from "./UpdatesSection.types";

function makeProps(overrides: Partial<UpdatesSectionProps> = {}): UpdatesSectionProps {
  return {
    status: "checking",
    currentVersion: "0.3.0",
    version: null,
    notes: null,
    percent: 0,
    error: null,
    check: vi.fn(),
    install: vi.fn(),
    relaunch: vi.fn(),
    ...overrides,
  };
}

it("shows the current version", () => {
  render(<UpdatesSection {...makeProps({ status: "upToDate", currentVersion: "0.3.0" })} />);
  expect(screen.getByText("Current: v0.3.0")).toBeInTheDocument();
});

it("shows a checking message while a check is in flight", () => {
  render(<UpdatesSection {...makeProps({ status: "checking" })} />);
  expect(screen.getByText("Checking for updates…")).toBeInTheDocument();
});

it("shows the up-to-date message when nothing is available", () => {
  render(<UpdatesSection {...makeProps({ status: "upToDate" })} />);
  expect(screen.getByText("You're on the latest version.")).toBeInTheDocument();
});

it("shows the available version with an Install button", () => {
  render(<UpdatesSection {...makeProps({ status: "available", version: "0.4.0" })} />);
  expect(screen.getByText("v0.4.0 available")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
});

it("shows release notes when present", () => {
  render(<UpdatesSection {...makeProps({ status: "available", version: "0.4.0", notes: "Fixes a crash." })} />);
  expect(screen.getByText("Fixes a crash.")).toBeInTheDocument();
});

it("calls install() when Install is clicked", async () => {
  const install = vi.fn();
  render(<UpdatesSection {...makeProps({ status: "available", version: "0.4.0", install })} />);
  await userEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(install).toHaveBeenCalledTimes(1);
});

it("shows a progress bar and percent while downloading", () => {
  render(<UpdatesSection {...makeProps({ status: "downloading", version: "0.4.0", percent: 42 })} />);
  expect(screen.getByText(/42%/)).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
});

it("shows a Restart to finish button once ready, calling relaunch() when clicked", async () => {
  const relaunch = vi.fn();
  render(<UpdatesSection {...makeProps({ status: "readyToRelaunch", version: "0.4.0", percent: 100, relaunch })} />);
  await userEvent.click(screen.getByRole("button", { name: "Restart to finish" }));
  expect(relaunch).toHaveBeenCalledTimes(1);
});

it("shows a quiet inline message (never a raw error) when the check failed", () => {
  render(<UpdatesSection {...makeProps({ status: "error", error: "signature is not valid" })} />);
  expect(screen.getByText("Couldn't check for updates.")).toBeInTheDocument();
  expect(screen.queryByText("signature is not valid")).not.toBeInTheDocument();
});

it("offers a Check for updates button when up to date or errored, calling check() when clicked", async () => {
  const check = vi.fn();
  render(<UpdatesSection {...makeProps({ status: "upToDate", check })} />);
  await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(check).toHaveBeenCalledTimes(1);
});

it("does not offer a Check for updates button mid-flight (checking/downloading)", () => {
  render(<UpdatesSection {...makeProps({ status: "downloading", version: "0.4.0" })} />);
  expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
});
