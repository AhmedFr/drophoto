import { render, screen } from "@testing-library/react";
import { GalleryPage } from "./GalleryPage";

it("renders the Gallery header", () => {
  render(<GalleryPage />);
  expect(screen.getByRole("heading")).toHaveTextContent("GALLERY");
});
