import { render, screen } from "@testing-library/react";
import { formatBytes } from "@/lib/format/bytes";
import type { Volume } from "@/lib/api/volumes";
import { VolumeList } from "./VolumeList";

const volumes: Volume[] = [
  {
    name: "Macintosh HD",
    mount_path: "/",
    total_bytes: 1_000_000_000,
    free_bytes: 400_000_000,
    is_removable: false,
  },
  {
    name: "Kodachrome",
    mount_path: "/Volumes/Kodachrome",
    total_bytes: 2_000_000_000,
    free_bytes: 1_500_000_000,
    is_removable: true,
  },
];

it("renders volume names and free space", () => {
  render(<VolumeList volumes={volumes} />);
  expect(screen.getByText("Macintosh HD")).toBeInTheDocument();
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText(new RegExp(formatBytes(400_000_000)))).toBeInTheDocument();
  expect(screen.getByText(new RegExp(formatBytes(1_500_000_000)))).toBeInTheDocument();
});
