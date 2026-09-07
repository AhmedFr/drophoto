import { ToolsSection } from "./components/ToolsSection";
import { RecoverDatesSection } from "./components/RecoverDatesSection";
import { SidecarsSection } from "./components/SidecarsSection";
import { useToolHealthData } from "./hooks/useToolHealthData";

/**
 * Settings' "Maintenance" group: external-tool health, filename-based
 * date recovery, and sidecar sync.
 */
export function MaintenanceSettingsPage() {
  const { tools, toolsLoading, toolsError } = useToolHealthData();

  return (
    <div className="flex flex-col">
      <ToolsSection tools={tools} loading={toolsLoading} error={toolsError} />

      <RecoverDatesSection />

      <SidecarsSection />
    </div>
  );
}
