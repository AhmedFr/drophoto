import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { renderTemplate, templateVarsFromDate } from "@/lib/organize/renderTemplate";
import { FOLDER_TEMPLATE_PRESETS, SAMPLE_DATE, SAMPLE_EXT, SAMPLE_STEM } from "./RuleEditor.constants";
import type { RuleEditorProps } from "./RuleEditor.types";

export function RuleEditor({
  rule,
  driveIds,
  drives,
  activeDriveId,
  onSelectDrive,
  onChange,
  onSave,
  saving,
  error,
  disabled = false,
}: RuleEditorProps) {
  return (
    <div className="flex flex-col gap-5">
      <span className="font-mono text-[9px] tracking-[2px] text-faint">HOW TO ORGANIZE</span>

      {!rule ? (
        <p className="font-mono text-[10px] text-faint">Loading rule…</p>
      ) : (
        <>
          {driveIds.length > 1 && (
            <select
              aria-label="Drive"
              disabled={disabled}
              className="border border-border bg-transparent px-2 py-1.5 font-mono text-[11px] disabled:opacity-50"
              value={activeDriveId}
              onChange={(e) => onSelectDrive(Number(e.target.value))}
            >
              {driveIds.map((id) => (
                <option key={id} value={id}>
                  {drives.find((d) => d.id === id)?.name ?? `Drive ${id}`}
                </option>
              ))}
            </select>
          )}

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-dim">Root</span>
            <Input
              aria-label="Root"
              disabled={disabled}
              className="font-mono text-[11px]"
              value={rule.root}
              onChange={(e) => onChange({ ...rule, root: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-dim">Folder template</span>
            <Input
              aria-label="Folder template"
              disabled={disabled}
              className="font-mono text-[11px]"
              value={rule.folder_tpl}
              onChange={(e) => onChange({ ...rule, folder_tpl: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-dim">File template</span>
            <Input
              aria-label="File template"
              disabled={disabled}
              className="font-mono text-[11px]"
              value={rule.file_tpl}
              onChange={(e) => onChange({ ...rule, file_tpl: e.target.value })}
            />
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled}
                className="self-start font-mono text-[10px] tracking-[1px]"
              >
                PRESETS
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {FOLDER_TEMPLATE_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset.label}
                  onSelect={() => onChange({ ...rule, folder_tpl: preset.folder_tpl })}
                >
                  {preset.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[13px]">Keep RAW + JPEG pairs</span>
              <span className="text-[11px] text-dim">Shared name, same folder</span>
            </div>
            <Switch
              disabled={disabled}
              checked={rule.keep_pairs}
              onCheckedChange={(checked) => onChange({ ...rule, keep_pairs: checked })}
            />
          </div>

          {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

          <Button
            size="sm"
            onClick={onSave}
            disabled={disabled || saving}
            className="self-start font-mono text-[10.5px] tracking-[1.5px]"
          >
            SAVE
          </Button>

          <RuleExample rule={rule} />
        </>
      )}
    </div>
  );
}

function RuleExample({ rule }: { rule: { root: string; folder_tpl: string; file_tpl: string } }) {
  const vars = templateVarsFromDate(SAMPLE_DATE, SAMPLE_STEM, SAMPLE_EXT);
  const exampleFile = `${renderTemplate(rule.file_tpl, vars)}.${SAMPLE_EXT}`;
  const exampleFolder = `${rule.root}/${renderTemplate(rule.folder_tpl, vars)}`;

  return (
    <div className="border border-border p-3 font-mono text-[10px] text-dim">
      <div className="text-faint">FORMAT</div>
      <div className="mt-1 truncate">{exampleFile}</div>
      <div className="mt-3 text-faint">FOLDERS</div>
      <div className="mt-1 truncate">{exampleFolder}</div>
    </div>
  );
}
