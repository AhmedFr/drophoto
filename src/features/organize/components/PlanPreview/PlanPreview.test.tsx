import { render, screen } from "@testing-library/react";
import type { PlanGroup } from "@/lib/organize/groupPlan";
import { PlanPreview } from "./PlanPreview";

function group(overrides: Partial<PlanGroup> = {}): PlanGroup {
  return {
    folder: "archive/2024/Q2",
    count: 1,
    more: 0,
    rows: [
      {
        media_id: 1,
        old_rel_path: "DCIM/100/IMG_0001.jpg",
        new_rel_path: "archive/2024/Q2/2024-06-15_IMG_0001.jpg",
        status: "planned",
        reason: null,
      },
    ],
    ...overrides,
  };
}

it("renders the folder path and file count", () => {
  render(<PlanPreview groups={[group()]} skippedDup={0} inPlace={false} />);
  expect(screen.getByText("archive/2024/Q2")).toBeInTheDocument();
  expect(screen.getByText("1 FILES")).toBeInTheDocument();
});

it("renders the old and new file names for each row", () => {
  render(<PlanPreview groups={[group()]} skippedDup={0} inPlace={false} />);
  expect(screen.getByText("IMG_0001.jpg")).toBeInTheDocument();
  expect(screen.getByText("2024-06-15")).toBeInTheDocument();
});

it("shows the more-in-this-folder note when a group has extra rows", () => {
  render(<PlanPreview groups={[group({ count: 5, more: 3 })]} skippedDup={0} inPlace={false} />);
  expect(screen.getByText("…and 3 more in this folder")).toBeInTheDocument();
});

it("omits the more note when there is nothing extra", () => {
  render(<PlanPreview groups={[group()]} skippedDup={0} inPlace={false} />);
  expect(screen.queryByText(/more in this folder/)).not.toBeInTheDocument();
});

it("shows the skipped-duplicates count when present", () => {
  render(<PlanPreview groups={[group()]} skippedDup={4} inPlace={false} />);
  expect(screen.getByText("4 duplicates skipped")).toBeInTheDocument();
});

it("shows an empty-state message when inPlace is true", () => {
  render(<PlanPreview groups={[]} skippedDup={0} inPlace={true} />);
  expect(screen.getByText(/Nothing to organize/)).toBeInTheDocument();
});
