import { render, screen, fireEvent } from "@testing-library/react";
import { Image, HardDrive } from "lucide-react";
import { vi } from "vitest";
import { Sidebar } from "./Sidebar";
const items = [
  { id: "drives", title: "Drives", path: "/drives", icon: HardDrive, order: 1, Page: () => null },
  { id: "gallery", title: "Gallery", path: "/gallery", icon: Image, order: 2, Page: () => null },
];
it("marks active item and navigates on click", () => {
  const onNavigate = vi.fn();
  render(<Sidebar items={items} activeId="gallery" onNavigate={onNavigate} />);
  expect(screen.getByRole("link", { name: /gallery/i })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("link", { name: /drives/i }));
  expect(onNavigate).toHaveBeenCalledWith("/drives");
});
