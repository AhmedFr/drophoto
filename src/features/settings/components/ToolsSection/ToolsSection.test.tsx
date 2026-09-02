import { render, screen } from "@testing-library/react";
import type { ToolStatus } from "@/lib/api/settings";
import { ToolsSection } from "./ToolsSection";

const found = (path: string, version = "13.10"): ToolStatus => ({ path, version, outdated: false });
const missing: ToolStatus = { path: null, version: null, outdated: false };

it("shows a loading message while the tool snapshot hasn't resolved", () => {
  render(<ToolsSection tools={null} loading={true} error={null} />);
  expect(screen.getByText("Checking tools…")).toBeInTheDocument();
});

it("shows where each tool was found with its version when both resolved current", () => {
  render(
    <ToolsSection
      tools={{ exiftool: found("/opt/homebrew/bin/exiftool", "13.10"), ffmpeg: found("/opt/homebrew/bin/ffmpeg", "7.1") }}
      loading={false}
      error={null}
    />,
  );
  expect(screen.getByText("found at /opt/homebrew/bin/exiftool · v13.10")).toBeInTheDocument();
  expect(screen.getByText("found at /opt/homebrew/bin/ffmpeg · v7.1")).toBeInTheDocument();
});

it("shows an amber outdated warning naming the floor and the brew upgrade fix", () => {
  render(
    <ToolsSection
      tools={{
        exiftool: { path: "/usr/local/bin/exiftool", version: "12.10", outdated: true },
        ffmpeg: found("/opt/homebrew/bin/ffmpeg", "7.1"),
      }}
      loading={false}
      error={null}
    />,
  );
  expect(
    screen.getByText(/v12\.10 is below the security floor \(12\.24\) — versions this old have known/),
  ).toBeInTheDocument();
  expect(screen.getByText("brew upgrade exiftool")).toBeInTheDocument();
});

it("shows a version-unknown state without an outdated warning", () => {
  render(
    <ToolsSection
      tools={{
        exiftool: found("/opt/homebrew/bin/exiftool", "13.10"),
        ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: null, outdated: false },
      }}
      loading={false}
      error={null}
    />,
  );
  expect(screen.getByText("found at /opt/homebrew/bin/ffmpeg · version unknown")).toBeInTheDocument();
  expect(screen.queryByText(/security floor/)).not.toBeInTheDocument();
});

it("shows a red missing state naming the consequence and the brew install fix", () => {
  render(
    <ToolsSection
      tools={{ exiftool: missing, ffmpeg: found("/usr/local/bin/ffmpeg", "7.1") }}
      loading={false}
      error={null}
    />,
  );
  expect(screen.getByText(/photo metadata and tag sidecars won't be read or written/)).toBeInTheDocument();
  expect(screen.getByText("brew install exiftool")).toBeInTheDocument();
  expect(screen.getByText("found at /usr/local/bin/ffmpeg · v7.1")).toBeInTheDocument();
});

it("shows the unavailable state when loading finished with no data", () => {
  render(<ToolsSection tools={null} loading={false} error={null} />);
  expect(screen.getByText("Tool status unavailable.")).toBeInTheDocument();
});

it("surfaces the query error instead of hiding it behind the neutral state", () => {
  render(<ToolsSection tools={null} loading={false} error="boom" />);
  expect(screen.getByText("boom")).toBeInTheDocument();
});
