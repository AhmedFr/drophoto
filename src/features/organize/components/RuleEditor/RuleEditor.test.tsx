import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { OrganizeRule } from "@/lib/api/organize";
import { RuleEditor } from "./RuleEditor";

function rule(overrides: Partial<OrganizeRule> = {}): OrganizeRule {
  return {
    drive_id: 1,
    root: "archive",
    folder_tpl: "{{yyyy}}/Q{{q}}",
    file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
    keep_pairs: true,
    ...overrides,
  };
}

function renderEditor(props: Partial<Parameters<typeof RuleEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onSelectDrive = vi.fn();
  render(
    <RuleEditor
      rule={rule()}
      driveIds={[1]}
      drives={[
        { id: 1, name: "Kodachrome" },
        { id: 2, name: "Ektachrome" },
      ]}
      activeDriveId={1}
      onSelectDrive={onSelectDrive}
      onChange={onChange}
      onSave={onSave}
      saving={false}
      error={null}
      {...props}
    />,
  );
  return { onChange, onSave, onSelectDrive };
}

it("renders the root, folder template, and file template inputs", () => {
  renderEditor();
  expect(screen.getByLabelText("Root")).toHaveValue("archive");
  expect(screen.getByLabelText("Folder template")).toHaveValue("{{yyyy}}/Q{{q}}");
  expect(screen.getByLabelText("File template")).toHaveValue("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}");
});

it("shows a loading state when the rule hasn't loaded yet", () => {
  renderEditor({ rule: null });
  expect(screen.getByText(/Loading rule/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Root")).not.toBeInTheDocument();
});

it("hides the drive selector for a single selected drive", () => {
  renderEditor({ driveIds: [1] });
  expect(screen.queryByLabelText("Drive")).not.toBeInTheDocument();
});

it("shows a drive selector for multiple selected drives and calls onSelectDrive", async () => {
  const user = userEvent.setup();
  const { onSelectDrive } = renderEditor({ driveIds: [1, 2], activeDriveId: 1 });
  await user.selectOptions(screen.getByLabelText("Drive"), "2");
  expect(onSelectDrive).toHaveBeenCalledWith(2);
});

it("editing the root input calls onChange with the updated rule", async () => {
  const user = userEvent.setup();
  const { onChange } = renderEditor();
  await user.type(screen.getByLabelText("Root"), "x");
  expect(onChange).toHaveBeenCalledWith({ ...rule(), root: "archivex" });
});

it("toggling the keep-pairs switch calls onChange", async () => {
  const user = userEvent.setup();
  const { onChange } = renderEditor();
  await user.click(screen.getByRole("switch"));
  expect(onChange).toHaveBeenCalledWith({ ...rule(), keep_pairs: false });
});

it("clicking SAVE calls onSave", async () => {
  const user = userEvent.setup();
  const { onSave } = renderEditor();
  await user.click(screen.getByRole("button", { name: "SAVE" }));
  expect(onSave).toHaveBeenCalled();
});

it("shows an inline error message when present", () => {
  renderEditor({ error: "root must not start with '/'" });
  expect(screen.getByText("root must not start with '/'")).toBeInTheDocument();
});

it("choosing the By quarter preset sets the folder template", async () => {
  const user = userEvent.setup();
  const { onChange } = renderEditor();
  await user.click(screen.getByRole("button", { name: "PRESETS" }));
  await user.click(await screen.findByRole("menuitem", { name: "By quarter" }));
  expect(onChange).toHaveBeenCalledWith({ ...rule(), folder_tpl: "{{yyyy}}/Q{{q}}" });
});

it("choosing the By day preset sets the folder template", async () => {
  const user = userEvent.setup();
  const { onChange } = renderEditor();
  await user.click(screen.getByRole("button", { name: "PRESETS" }));
  await user.click(await screen.findByRole("menuitem", { name: "By day" }));
  expect(onChange).toHaveBeenCalledWith({ ...rule(), folder_tpl: "{{yyyy}}/{{yyyy}}-{{mm}}-{{dd}}" });
});

it("renders the FORMAT/FOLDERS example rendered from the sample date", () => {
  renderEditor();
  expect(screen.getByText("FORMAT")).toBeInTheDocument();
  expect(screen.getByText("2024-06-15_IMG_4821.cr2")).toBeInTheDocument();
  expect(screen.getByText("FOLDERS")).toBeInTheDocument();
  expect(screen.getByText("archive/2024/Q2")).toBeInTheDocument();
});

it("disables the inputs and SAVE while disabled is true", () => {
  renderEditor({ disabled: true, driveIds: [1, 2], activeDriveId: 1 });
  expect(screen.getByLabelText("Root")).toBeDisabled();
  expect(screen.getByLabelText("Folder template")).toBeDisabled();
  expect(screen.getByLabelText("File template")).toBeDisabled();
  expect(screen.getByLabelText("Drive")).toBeDisabled();
  expect(screen.getByRole("switch")).toBeDisabled();
  expect(screen.getByRole("button", { name: "SAVE" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PRESETS" })).toBeDisabled();
});

it("leaves the inputs enabled when disabled is false (the default)", () => {
  renderEditor();
  expect(screen.getByLabelText("Root")).not.toBeDisabled();
  expect(screen.getByRole("switch")).not.toBeDisabled();
});

it("labels each drive option with the drive's name, not its id", () => {
  renderEditor({ driveIds: [1, 2] });
  expect(screen.getByRole("option", { name: "Kodachrome" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Ektachrome" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Drive 1" })).not.toBeInTheDocument();
});

it("falls back to Drive {id} for a drive it has no name for", () => {
  renderEditor({ driveIds: [1, 9], drives: [{ id: 1, name: "Kodachrome" }] });
  expect(screen.getByRole("option", { name: "Drive 9" })).toBeInTheDocument();
});
