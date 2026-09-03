import { ToolsSection } from "./components/ToolsSection";
import { SidecarsSection } from "./components/SidecarsSection";
import { useToolHealthData } from "./hooks/useToolHealthData";

/** Settings' "Maintenance" group: external-tool health, and sidecar sync. */
export function MaintenanceSettingsPage() {
  const { tools, toolsLoading, toolsError } = useToolHealthData();

  return (
    <div className="flex flex-col">
      <ToolsSection tools={tools} loading={toolsLoading} error={toolsError} />

      <SidecarsSection />
    </div>
  );
}
