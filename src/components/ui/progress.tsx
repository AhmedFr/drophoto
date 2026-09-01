"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /**
   * Renders a sliding bar with no numeric meaning instead of a
   * `value`-driven fill — for phases (e.g. a scan's directory walk) that
   * have no done/total to show yet. Purely a CSS animation on the
   * indicator, so swapping this on/off never unmounts the bar itself —
   * see `ScanProgress`, which relies on that for a stable layout across
   * every non-terminal state.
   */
  indeterminate?: boolean
}

function Progress({
  className,
  value,
  indeterminate = false,
  ...props
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full bg-primary transition-all",
          indeterminate
            ? "w-1/3 animate-[scan-indeterminate_1.1s_ease-in-out_infinite]"
            : "w-full flex-1"
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
