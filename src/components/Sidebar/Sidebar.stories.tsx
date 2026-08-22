import type { Meta, StoryObj } from "@storybook/react-vite";
import { HardDrive, Image, Settings } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { Sidebar } from "./Sidebar";

const items: FeatureModule[] = [
  { id: "drives", title: "Drives", path: "/drives", icon: HardDrive, order: 1, Page: () => null },
  { id: "gallery", title: "Gallery", path: "/gallery", icon: Image, order: 2, Page: () => null },
  { id: "settings", title: "Settings", path: "/settings", icon: Settings, order: 3, Page: () => null },
];

const meta = {
  title: "App/Sidebar",
  component: Sidebar,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { items, activeId: "gallery", onNavigate: () => {} },
};
