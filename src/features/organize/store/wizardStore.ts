import { create } from "zustand";

type WizardState = {
  step: 0 | 1;
  selectedDriveIds: number[];
  toggleDrive: (driveId: number) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
};

const DEFAULTS: Pick<WizardState, "step" | "selectedDriveIds"> = {
  step: 0,
  selectedDriveIds: [],
};

/**
 * Drives the Organize wizard's step (Detect → Organize) and the set of
 * drives selected on the Detect step. Deliberately not persisted — the
 * wizard always starts fresh at step 0 with nothing selected.
 */
export const useWizardStore = create<WizardState>((set) => ({
  ...DEFAULTS,
  toggleDrive: (driveId) =>
    set((s) => ({
      selectedDriveIds: s.selectedDriveIds.includes(driveId)
        ? s.selectedDriveIds.filter((id) => id !== driveId)
        : [...s.selectedDriveIds, driveId],
    })),
  next: () => set((s) => ({ step: s.step === 0 ? 1 : s.step })),
  back: () => set((s) => ({ step: s.step === 1 ? 0 : s.step })),
  reset: () => set({ ...DEFAULTS }),
}));
