import { Toaster } from "sonner";
import { JobEventsBridge } from "@/components/JobEventsBridge";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import type { AppShellProps } from "./AppShell.types";

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Mounted once here (rather than per-page) so job progress keeps
          tracking, and completion gets toasted, no matter which page is
          on screen — see `JobEventsBridge`. */}
      <JobEventsBridge />
      {/* Mounted once here too — the app's single startup update check,
          independent of whether Settings is ever opened; see
          `UpdateNotifier`'s own docs. */}
      <UpdateNotifier />
      {sidebar}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          className:
            "!rounded-none !border !border-border !bg-surface !font-mono !text-[11px] !text-foreground",
          descriptionClassName: "!font-mono",
        }}
      />
    </div>
  );
}
