import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { OrganizePlan } from "@/lib/api/organize";
import type { UseRuleResult } from "../../hooks/useRule.types";
import { OrganizeStep } from "./OrganizeStep";

function ruleResult(overrides: Partial<UseRuleResult> = {}): UseRuleResult {
  return {
    driveIds: [1],
    activeDriveId: 1,
    setActiveDriveId: vi.fn(),
    rule: {
      drive_id: 1,
      root: "archive",
      folder_tpl: "{{yyyy}}/Q{{q}}",
      file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
      keep_pairs: true,
    },
    onChange: vi.fn(),
    onSave: vi.fn(),
    saving: false,
    isDirty: false,
    error: null,
    ...overrides,
  };
}

const drives = [
  { id: 1, name: "Kodachrome" },
  { id: 2, name: "Ektachrome" },
];

function plan(items: OrganizePlan["items"]): OrganizePlan {
  return {
    items,
    planned: items.filter((i) => i.status === "planned").length,
    skipped_dup: 0,
    bytes: 0,
  };
}

it("shows a planning message while the plan is loading", () => {
  render(<OrganizeStep plan={undefined} isPlanning={true} rule={ruleResult()} drives={drives} running={false} />);
  expect(screen.getByText("Planning…")).toBeInTheDocument();
});

it("renders grouped plan items in PlanPreview and the RuleEditor side by side", () => {
  const p = plan([
    {
      media_id: 1,
      old_rel_path: "DCIM/IMG_0001.jpg",
      new_rel_path: "archive/2025/Q4/2025-11-02_IMG_0001.jpg",
      status: "planned",
      reason: null,
    },
  ]);
  render(<OrganizeStep plan={p} isPlanning={false} rule={ruleResult()} drives={drives} running={false} />);

  expect(screen.getByText("archive/2025/Q4")).toBeInTheDocument();
  expect(screen.getByLabelText("Root")).toHaveValue("archive");
});

it("shows the PlanPreview empty state when there's nothing planned", () => {
  render(<OrganizeStep plan={plan([])} isPlanning={false} rule={ruleResult()} drives={drives} running={false} />);
  expect(screen.getByText(/Nothing to organize/)).toBeInTheDocument();
});

it("disables the RuleEditor's inputs while running", () => {
  render(<OrganizeStep plan={plan([])} isPlanning={false} rule={ruleResult()} drives={drives} running={true} />);
  expect(screen.getByLabelText("Root")).toBeDisabled();
});

it("labels the drive selector with drive names when more than one drive is selected", () => {
  render(
    <OrganizeStep
      plan={plan([])}
      isPlanning={false}
      rule={ruleResult({ driveIds: [1, 2] })}
      drives={drives}
      running={false}
    />,
  );
  expect(screen.getByRole("option", { name: "Kodachrome" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Ektachrome" })).toBeInTheDocument();
});
