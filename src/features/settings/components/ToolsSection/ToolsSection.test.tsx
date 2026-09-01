import { render, screen } from "@testing-library/react";
import { ToolsSection } from "./ToolsSection";

it("shows a loading message while the tool snapshot hasn't resolved", () => {
  render(<ToolsSection tools={null} loading={true} error={null} />);
  expect(screen.getByText("Checking tools…")).toBeInTheDocument();
});

it("shows where each tool was found when both resolved", () => {
  render(
    <ToolsSection
      tools={{ exiftool: "/opt/homebrew/bin/exiftool", ffmpeg: "/opt/homebrew/bin/ffmpeg" }}
      loading={false}
      error={null}
    />,
  );
  expect(screen.getByText("found at /opt/homebrew/bin/exiftool")).toBeInTheDocument();
  expect(screen.getByText("found at /opt/homebrew/bin/ffmpeg")).toBeInTheDocument();
});

it("shows a red missing state naming the consequence and the brew install fix", () => {
  render(<ToolsSection tools={{ exiftool: null, ffmpeg: "/usr/local/bin/ffmpeg" }} loading={false} error={null} />);
  expect(screen.getByText(/photo metadata and tag sidecars won't be read or written/)).toBeInTheDocument();
  expect(screen.getByText("brew install exiftool")).toBeInTheDocument();
  expect(screen.getByText("found at /usr/local/bin/ffmpeg")).toBeInTheDocument();
});

it("shows the unavailable state when loading finished with no data", () => {
  render(<ToolsSection tools={null} loading={false} error={null} />);
  expect(screen.getByText("Tool status unavailable.")).toBeInTheDocument();
});

it("surfaces the query error instead of hiding it behind the neutral state", () => {
  render(<ToolsSection tools={null} loading={false} error="boom" />);
  expect(screen.getByText("boom")).toBeInTheDocument();
});
