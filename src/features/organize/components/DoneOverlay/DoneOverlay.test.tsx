import { screen, fireEvent } from "@testing-library/react";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useWizardStore } from "../../store/wizardStore";
import { DoneOverlay } from "./DoneOverlay";

beforeEach(() => {
  useWizardStore.setState({ step: 1, selectedDriveIds: [1, 2] });
});

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

it("shows a foldersHint next to Filed into when given", async () => {
  renderWithRouter(
    <DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={["a/2024"]} foldersHint="from the plan" />,
  );
  expect(await screen.findByText("(from the plan)")).toBeInTheDocument();
});

it("omits the hint when not given", async () => {
  renderWithRouter(<DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={["a/2024"]} />);
  expect(screen.queryByText(/from the plan/)).not.toBeInTheDocument();
});

it("is an accessible modal dialog", async () => {
  renderWithRouter(<DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  const dialog = await screen.findByRole("dialog", { name: "Organized" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
});

it("resets the wizard to step 0 with no selection when OPEN GALLERY is clicked", async () => {
  renderWithRouter(<DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  fireEvent.click(await screen.findByRole("link", { name: "OPEN GALLERY →" }));
  expect(useWizardStore.getState()).toMatchObject({ step: 0, selectedDriveIds: [] });
});

it("resets the wizard to step 0 with no selection when DASHBOARD is clicked", async () => {
  renderWithRouter(<DoneOverlay moved={1} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  fireEvent.click(await screen.findByRole("link", { name: "DASHBOARD" }));
  expect(useWizardStore.getState()).toMatchObject({ step: 0, selectedDriveIds: [] });
});

it("reports a cancelled run as CANCELLED, not as a success", async () => {
  renderWithRouter(
    <DoneOverlay moved={7} skipped={1} failed={0} fileTpl="t" folders={["a/2024"]} cancelled />,
  );

  expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
  expect(screen.queryByText("ORGANIZED")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "7 photos filed before cancelling" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Remaining photos were left in place.")).toBeInTheDocument();
});

it("is labelled Cancelled as a dialog when the run was cancelled", async () => {
  renderWithRouter(<DoneOverlay moved={0} skipped={0} failed={0} fileTpl="t" folders={[]} cancelled />);
  const dialog = await screen.findByRole("dialog", { name: "Cancelled" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
});

it("omits the cancelled note on a run that completed", async () => {
  renderWithRouter(<DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  expect(await screen.findByRole("heading", { name: "7 photos filed" })).toBeInTheDocument();
  expect(screen.queryByText("Remaining photos were left in place.")).not.toBeInTheDocument();
});

it("omits the REVERT button when onRevert is not given", async () => {
  renderWithRouter(<DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} />);
  await screen.findByText("ORGANIZED");
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("omits the REVERT button when nothing was moved", async () => {
  renderWithRouter(
    <DoneOverlay moved={0} skipped={0} failed={0} fileTpl="t" folders={[]} onRevert={vi.fn()} />,
  );
  await screen.findByText("ORGANIZED");
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("omits the REVERT button on a cancelled run", async () => {
  renderWithRouter(
    <DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} cancelled onRevert={vi.fn()} />,
  );
  await screen.findByText("CANCELLED");
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("shows a REVERT button and opens the confirm dialog when clicked", async () => {
  renderWithRouter(
    <DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} onRevert={vi.fn()} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "REVERT" }));
  expect(
    await screen.findByText("Move 7 files back to their original locations?"),
  ).toBeInTheDocument();
});

it("calls onRevert and closes the dialog when the revert is confirmed", async () => {
  const onRevert = vi.fn();
  renderWithRouter(
    <DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} onRevert={onRevert} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "REVERT" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revert" }));
  expect(onRevert).toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Revert this run?" })).not.toBeInTheDocument();
});

it("does not call onRevert when the confirm dialog is cancelled", async () => {
  const onRevert = vi.fn();
  renderWithRouter(
    <DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} onRevert={onRevert} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "REVERT" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(onRevert).not.toHaveBeenCalled();
});

it("shows reverting progress and disables the button while reverting", async () => {
  renderWithRouter(
    <DoneOverlay
      moved={7}
      skipped={0}
      failed={0}
      fileTpl="t"
      folders={[]}
      onRevert={vi.fn()}
      reverting
      revertProgress={{ done: 2, total: 7 }}
    />,
  );
  const button = await screen.findByRole("button", { name: "REVERTING… 2/7" });
  expect(button).toBeDisabled();
});

it("shows REVERTED in place of the button once reverted", async () => {
  renderWithRouter(
    <DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} onRevert={vi.fn()} reverted />,
  );
  expect(await screen.findByText("REVERTED")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("shows a revertError message inline and keeps the REVERT button available", async () => {
  renderWithRouter(
    <DoneOverlay
      moved={7}
      skipped={0}
      failed={0}
      fileTpl="t"
      folders={[]}
      onRevert={vi.fn()}
      revertError="REVERT FAILED — 2 files could not be moved back"
    />,
  );
  expect(
    await screen.findByText("REVERT FAILED — 2 files could not be moved back"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "REVERT" })).toBeInTheDocument();
  expect(screen.queryByText("REVERTED")).not.toBeInTheDocument();
});

it("omits the revertError message when there isn't one", async () => {
  renderWithRouter(
    <DoneOverlay moved={7} skipped={0} failed={0} fileTpl="t" folders={[]} onRevert={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "REVERT" });
  expect(screen.queryByText(/REVERT FAILED/)).not.toBeInTheDocument();
});

it("omits the revertError message when the REVERT action itself is unavailable", async () => {
  renderWithRouter(
    <DoneOverlay
      moved={0}
      skipped={0}
      failed={0}
      fileTpl="t"
      folders={[]}
      revertError="should never show without onRevert/moved"
    />,
  );
  await screen.findByText("ORGANIZED");
  expect(screen.queryByText("should never show without onRevert/moved")).not.toBeInTheDocument();
});
