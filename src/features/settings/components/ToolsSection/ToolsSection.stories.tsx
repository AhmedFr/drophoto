import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolsSection } from "./ToolsSection";

const meta = {
  title: "Settings/ToolsSection",
  component: ToolsSection,
} satisfies Meta<typeof ToolsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both tools found at current versions — the healthy default. */
export const Current: Story = {
  args: {
    tools: {
      exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
      ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "7.1", outdated: false },
    },
    loading: false,
    error: null,
  },
};

/** exiftool below its security floor — the amber warning with the brew upgrade remediation (issue #29). */
export const Outdated: Story = {
  args: {
    tools: {
      exiftool: { path: "/usr/local/bin/exiftool", version: "12.05", outdated: true },
      ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "7.1", outdated: false },
    },
    loading: false,
    error: null,
  },
};

/** ffmpeg found but its version didn't parse (e.g. a dev build) — unknown, never flagged outdated. */
export const VersionUnknown: Story = {
  args: {
    tools: {
      exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
      ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: null, outdated: false },
    },
    loading: false,
    error: null,
  },
};

/** exiftool missing entirely — the red state naming the consequence and install one-liner. */
export const Missing: Story = {
  args: {
    tools: {
      exiftool: { path: null, version: null, outdated: false },
      ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "7.1", outdated: false },
    },
    loading: false,
    error: null,
  },
};
