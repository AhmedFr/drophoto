import { beforeEach, describe, expect, it } from "vitest";
import { useWizardStore } from "./wizardStore";

beforeEach(() => {
  useWizardStore.setState({ step: 0, selectedDriveIds: [] });
});

describe("useWizardStore", () => {
  it("defaults to step 0 with nothing selected", () => {
    const state = useWizardStore.getState();
    expect(state.step).toBe(0);
    expect(state.selectedDriveIds).toEqual([]);
  });

  it("toggleDrive adds an unselected drive id", () => {
    useWizardStore.getState().toggleDrive(1);
    expect(useWizardStore.getState().selectedDriveIds).toEqual([1]);
  });

  it("toggleDrive removes an already-selected drive id", () => {
    useWizardStore.getState().toggleDrive(1);
    useWizardStore.getState().toggleDrive(1);
    expect(useWizardStore.getState().selectedDriveIds).toEqual([]);
  });

  it("toggleDrive tracks multiple drives independently", () => {
    useWizardStore.getState().toggleDrive(1);
    useWizardStore.getState().toggleDrive(2);
    useWizardStore.getState().toggleDrive(1);
    expect(useWizardStore.getState().selectedDriveIds).toEqual([2]);
  });

  it("next advances from step 0 to step 1", () => {
    useWizardStore.getState().next();
    expect(useWizardStore.getState().step).toBe(1);
  });

  it("next is a no-op at step 1", () => {
    useWizardStore.setState({ step: 1 });
    useWizardStore.getState().next();
    expect(useWizardStore.getState().step).toBe(1);
  });

  it("back moves from step 1 to step 0", () => {
    useWizardStore.setState({ step: 1 });
    useWizardStore.getState().back();
    expect(useWizardStore.getState().step).toBe(0);
  });

  it("back is a no-op at step 0", () => {
    useWizardStore.getState().back();
    expect(useWizardStore.getState().step).toBe(0);
  });

  it("reset restores step 0 and clears selection", () => {
    useWizardStore.getState().toggleDrive(1);
    useWizardStore.getState().next();
    useWizardStore.getState().reset();
    const state = useWizardStore.getState();
    expect(state.step).toBe(0);
    expect(state.selectedDriveIds).toEqual([]);
  });
});
