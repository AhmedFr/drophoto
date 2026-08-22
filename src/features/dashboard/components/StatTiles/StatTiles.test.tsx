import { render, screen } from "@testing-library/react";
import { StatTiles } from "./StatTiles";

it("renders photos, videos, unorganized, and drives online tiles", () => {
  render(<StatTiles photos={120} videos={8} unorganized={15} drivesOnline={2} drivesTotal={3} />);

  expect(screen.getByText("120")).toBeInTheDocument();
  expect(screen.getByText("PHOTOS")).toBeInTheDocument();
  expect(screen.getByText("8")).toBeInTheDocument();
  expect(screen.getByText("VIDEOS")).toBeInTheDocument();
  expect(screen.getByText("15")).toBeInTheDocument();
  expect(screen.getByText("UNORGANIZED")).toBeInTheDocument();
  expect(screen.getByText("2/3")).toBeInTheDocument();
  expect(screen.getByText("DRIVES ONLINE")).toBeInTheDocument();
});

it("renders zero values as 0", () => {
  render(<StatTiles photos={0} videos={0} unorganized={0} drivesOnline={0} drivesTotal={0} />);
  expect(screen.getAllByText("0")).toHaveLength(3);
  expect(screen.getByText("0/0")).toBeInTheDocument();
});
