import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { OrganizeDefaultsSection } from "./OrganizeDefaultsSection";

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizeDefaultsSection />
    </QueryClientProvider>,
  );
}

it("shows a loading state before the defaults have loaded", () => {
  // A promise that never resolves — keeps the query pending indefinitely.
  mockIPC(() => new Promise(() => {}));
  renderSection();
  expect(screen.getByText(/Loading organize defaults/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Default root")).not.toBeInTheDocument();
});

it("prefills the inputs from the saved defaults", async () => {
  mockIPC((cmd) =>
    cmd === "get_organize_defaults"
      ? { root: "sorted", folder_tpl: "{{yyyy}}/{{mm}}", file_tpl: "{{stem}}", keep_pairs: false }
      : undefined,
  );
  renderSection();

  expect(await screen.findByLabelText("Default root")).toHaveValue("sorted");
  expect(screen.getByLabelText("Default folder template")).toHaveValue("{{yyyy}}/{{mm}}");
  expect(screen.getByLabelText("Default file template")).toHaveValue("{{stem}}");
  expect(screen.getByRole("switch")).not.toBeChecked();
});

it("prefills the inputs with the hardcoded fallback when nothing is configured", async () => {
  mockIPC((cmd) =>
    cmd === "get_organize_defaults"
      ? { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null }
      : undefined,
  );
  renderSection();

  expect(await screen.findByLabelText("Default root")).toHaveValue("archive");
  expect(screen.getByLabelText("Default folder template")).toHaveValue("{{yyyy}}/Q{{q}}");
  expect(screen.getByLabelText("Default file template")).toHaveValue("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}");
  expect(screen.getByRole("switch")).toBeChecked();
});

it("choosing a preset fills the folder template", async () => {
  mockIPC((cmd) =>
    cmd === "get_organize_defaults"
      ? { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null }
      : undefined,
  );
  const user = userEvent.setup();
  renderSection();

  await screen.findByLabelText("Default root");
  await user.click(screen.getByRole("button", { name: "PRESETS" }));
  await user.click(await screen.findByRole("menuitem", { name: "Flat by date" }));

  expect(screen.getByLabelText("Default folder template")).toHaveValue("{{yyyy}}-{{mm}}-{{dd}}");
});

it("toggling the keep-pairs switch updates the draft", async () => {
  mockIPC((cmd) =>
    cmd === "get_organize_defaults"
      ? { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null }
      : undefined,
  );
  const user = userEvent.setup();
  renderSection();

  await screen.findByLabelText("Default root");
  await user.click(screen.getByRole("switch"));

  expect(screen.getByRole("switch")).not.toBeChecked();
});

it("saves the edited defaults", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "get_organize_defaults") {
      return { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null };
    }
    if (cmd === "set_organize_defaults") {
      received = args;
      return null;
    }
    return undefined;
  });
  const user = userEvent.setup();
  renderSection();

  await screen.findByLabelText("Default root");
  fireEvent.change(screen.getByLabelText("Default root"), { target: { value: "sorted" } });
  await user.click(screen.getByRole("button", { name: "SAVE" }));

  await waitFor(() =>
    expect(received).toEqual({
      defaults: {
        root: "sorted",
        folder_tpl: "{{yyyy}}/Q{{q}}",
        file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
        keep_pairs: true,
      },
    }),
  );
});

it("shows an inline validation error when the save is refused", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_organize_defaults") {
      return { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null };
    }
    if (cmd === "set_organize_defaults") {
      throw { code: "unsupported", message: "root must not start with '/'" };
    }
    return undefined;
  });
  renderSection();

  await screen.findByLabelText("Default root");
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

  expect(await screen.findByText("root must not start with '/'")).toBeInTheDocument();
});
