import { Folder } from "lucide-react";
import { basename } from "@/lib/media/format";
import { splitFileName } from "@/lib/organize/splitFileName";
import type { PlanPreviewProps } from "./PlanPreview.types";

export function PlanPreview({ groups, skippedDup, inPlace }: PlanPreviewProps) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto border-r border-border p-6 pr-8">
      <p className="mb-5 text-[13px] text-muted-foreground">
        Preview of every rename and its destination folder. Nothing is moved until you confirm.
      </p>

      {inPlace ? (
        <p className="font-mono text-[11px] text-faint">Nothing to organize — every file is already in place.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.folder} className="flex flex-col">
              <div className="mb-2 flex items-center gap-2">
                <Folder className="size-3.5 flex-none text-faint" aria-hidden />
                <span className="min-w-0 truncate font-mono text-[12px]">{group.folder || "/"}</span>
                <span className="flex-none font-mono text-[10px] text-faint">{group.count} FILES</span>
              </div>
              <ul className="border border-border">
                {group.rows.map((row) => {
                  const oldName = basename(row.old_rel_path);
                  const { date, rest, ext } = splitFileName(basename(row.new_rel_path));
                  return (
                    <li
                      key={row.media_id}
                      className="flex items-center gap-3 border-b border-surface-2 px-[15px] py-[11px] font-mono text-[11px] last:border-b-0"
                    >
                      <span className="w-[118px] flex-none truncate text-faint">{oldName}</span>
                      <span className="flex-none text-faint">→</span>
                      <span className="min-w-0 truncate">
                        {date && <span className="text-foreground">{date}</span>}
                        <span className="text-[#b4b4b0]">{rest}</span>
                        <span className="text-muted-foreground">{ext}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {group.more > 0 && (
                <span className="mt-1.5 font-mono text-[10px] text-faint">
                  …and {group.more} more in this folder
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {skippedDup > 0 && (
        <p className="mt-6 font-mono text-[10px] text-faint">
          {skippedDup} duplicate{skippedDup === 1 ? "" : "s"} skipped
        </p>
      )}
    </div>
  );
}
