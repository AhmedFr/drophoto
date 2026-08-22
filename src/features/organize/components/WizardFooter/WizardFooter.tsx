import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { Button } from "@/components/ui/button";
import type { WizardFooterProps } from "./WizardFooter.types";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function WizardFooter({
  step,
  totalSteps,
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  running,
  error,
}: WizardFooterProps) {
  return (
    <footer className="flex h-[66px] flex-none items-center gap-4 border-t border-border px-[22px]">
      {/*
        Widened `Link` generics: the route tree is built dynamically from
        `FEATURES` (see `GalleryToolbar`), so it can't be type-checked
        against a literal `to`. This keeps a real `Link` (active-state,
        prefetch) without an unchecked `to` string.
      */}
      <Link<typeof router, string, string>
        to="/"
        className="font-mono text-[10px] tracking-[1.5px] text-faint"
      >
        CANCEL
      </Link>
      <div className="flex-1" />
      {error && <span className="font-mono text-[10.5px] text-red-400">{error}</span>}
      {running && (
        <>
          <span className="font-mono text-[10.5px] tracking-[1.5px] text-muted-foreground">
            MOVING {running.done} / {running.total}
          </span>
          <Button variant="outline" size="sm" onClick={running.onCancel}>
            CANCEL
          </Button>
        </>
      )}
      <span className="font-mono text-[10.5px] tracking-[1.5px] text-faint">
        STEP {pad2(step + 1)} / {pad2(totalSteps)}
      </span>
      {step > 0 && (
        <Button variant="outline" size="sm" onClick={onBack}>
          ← BACK
        </Button>
      )}
      <Button
        size="sm"
        disabled={primaryDisabled}
        onClick={onPrimary}
        className="font-mono text-[10.5px] tracking-[1.5px]"
      >
        {primaryLabel}
      </Button>
    </footer>
  );
}
