import { screen } from "@testing-library/react";
import { renderWithRouter } from "@/test/renderWithRouter";
import { DoneOverlay } from "./DoneOverlay";

it("shows the moved count headline and ORGANIZED label", async () => {
  renderWithRouter(<DoneOverlay moved={42} skipped={2} failed={0} fileTpl="{{yyyy}}-{{mm}}-{{dd}}_{{stem}}" folders={[]} />);
  expect(await screen.findByText("ORGANIZED")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "42 photos filed" })).toBeInTheDocument();
});

it("shows the file template and skipped/failed counts", async () => {
  renderWithRouter(
    <DoneOverlay moved={42} skipped={3} failed={1} fileTpl="{{yyyy}}-{{mm}}-{{dd}}_{{stem}}" folders={[]} />,
  );
  expect(await screen.findByText("Renamed to {{yyyy}}-{{mm}}-{{dd}}_{{stem}}")).toBeInTheDocument();
  expect(screen.getByText("3 skipped · 1 failed")).toBeInTheDocument();
});

it("lists up to three folders", async () => {
  renderWithRouter(
    <DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={["a/2024", "a/2023", "a/2022"]} />,
  );
  expect(await screen.findByText("Filed into a/2024, a/2023, a/2022")).toBeInTheDocument();
});

it("summarizes more than three folders with a +N more suffix", async () => {
  renderWithRouter(
    <DoneOverlay
      moved={1}
      skipped={0}
      failed={0}
      fileTpl="t"
      folders={["a/2024", "a/2023", "a/2022", "a/2021"]}
    />,
  );
  expect(await screen.findByText("Filed into a/2024, a/2023, a/2022 +1 more")).toBeInTheDocument();
});

it("shows a dash when there are no folders", async () => {
  renderWithRouter(<DoneOverlay moved={0} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  expect(await screen.findByText("Filed into —")).toBeInTheDocument();
});

it("links OPEN GALLERY to /gallery and DASHBOARD to /", async () => {
  renderWithRouter(<DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  expect(await screen.findByRole("link", { name: "OPEN GALLERY →" })).toHaveAttribute("href", "/gallery");
  expect(screen.getByRole("link", { name: "DASHBOARD" })).toHaveAttribute("href", "/");
});
