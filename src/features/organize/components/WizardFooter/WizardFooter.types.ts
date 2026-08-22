export type WizardFooterProps = {
  step: 0 | 1;
  totalSteps: number;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
};
