import { Grid3x3, LayoutGrid, Rows3 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type Density, useGalleryStore } from "../../store/galleryStore";

const DENSITY_OPTIONS: { value: Density; label: string; Icon: typeof Rows3 }[] = [
  { value: "Comfortable", label: "Comfortable", Icon: Rows3 },
  { value: "Compact", label: "Compact", Icon: LayoutGrid },
  { value: "Dense", label: "Dense", Icon: Grid3x3 },
];

export function DensityToggle() {
  const density = useGalleryStore((s) => s.density);
  const setDensity = useGalleryStore((s) => s.setDensity);

  return (
    <TooltipProvider>
      <ToggleGroup
        type="single"
        value={density}
        onValueChange={(value) => {
          // Radix emits "" when clicking the already-active item — ignore
          // it so density can never become unset.
          if (value) setDensity(value as Density);
        }}
        className="border border-border-2"
      >
        {DENSITY_OPTIONS.map(({ value, label, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={value}
                aria-label={label}
                className="text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground hover:text-foreground"
              >
                <Icon size={14} />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </TooltipProvider>
  );
}
