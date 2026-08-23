import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { it, expect, vi } from "vitest";
import { TagPanel } from "./TagPanel";

function renderPanel(props: { mediaIds: number[]; open: boolean; onClose?: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TagPanel mediaIds={props.mediaIds} open={props.open} onClose={props.onClose ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

it("is closed when open is false", () => {
  mockIPC(() => undefined);
  renderPanel({ mediaIds: [1], open: false });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows every tag, checked for full coverage and indeterminate for partial", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") {
      return [
        { id: 1, name: "Family" },
        { id: 2, name: "Beach" },
      ];
    }
    if (cmd === "tags_for_media") {
      return [
        [1, { id: 1, name: "Family" }],
        [2, { id: 1, name: "Family" }],
        [1, { id: 2, name: "Beach" }],
      ];
    }
    return undefined;
  });
  renderPanel({ mediaIds: [1, 2], open: true });

  const familyRow = (await screen.findByText("Family")).closest("label") as HTMLElement;
  expect(within(familyRow).getByRole("checkbox")).toHaveAttribute("data-state", "checked");

  const beachRow = screen.getByText("Beach").closest("label") as HTMLElement;
  expect(within(beachRow).getByRole("checkbox")).toHaveAttribute("data-state", "indeterminate");
});

it("filters tags case-insensitively", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") {
      return [
        { id: 1, name: "Family" },
        { id: 2, name: "Beach" },
      ];
    }
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  await screen.findByText("Family");
  fireEvent.change(screen.getByPlaceholderText(/filter or create/i), { target: { value: "fam" } });

  expect(screen.getByText("Family")).toBeInTheDocument();
  expect(screen.queryByText("Beach")).not.toBeInTheDocument();
});

it("offers CREATE when the filter text has no exact match", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  await screen.findByText("Family");
  fireEvent.change(screen.getByPlaceholderText(/filter or create/i), { target: { value: "Sunset" } });

  expect(screen.getByRole("button", { name: /create "sunset"/i })).toBeInTheDocument();
});

it("does not offer CREATE when the filter text exactly matches an existing tag", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  await screen.findByText("Family");
  fireEvent.change(screen.getByPlaceholderText(/filter or create/i), { target: { value: "family" } });

  expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
});

it("clicking CREATE stages a new tag row and clears the input", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  const input = await screen.findByPlaceholderText(/filter or create/i);
  fireEvent.change(input, { target: { value: "Sunset" } });
  fireEvent.click(screen.getByRole("button", { name: /create "sunset"/i }));

  expect(screen.getByText("Sunset")).toBeInTheDocument();
  expect(screen.getByText("(new)")).toBeInTheDocument();
  expect(input).toHaveValue("");
});

it("clicking a staged create's checkbox unstages it", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  const input = await screen.findByPlaceholderText(/filter or create/i);
  fireEvent.change(input, { target: { value: "Sunset" } });
  fireEvent.click(screen.getByRole("button", { name: /create "sunset"/i }));

  const stagedRow = screen.getByText("Sunset").closest("label") as HTMLElement;
  fireEvent.click(within(stagedRow).getByRole("checkbox"));

  expect(screen.queryByText("Sunset")).not.toBeInTheDocument();
  expect(screen.queryByText("(new)")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
});

it("cycles a tag's staged state none -> all -> none on repeated clicks", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  const row = (await screen.findByText("Family")).closest("label") as HTMLElement;
  const checkbox = within(row).getByRole("checkbox");
  expect(checkbox).toHaveAttribute("data-state", "unchecked");

  fireEvent.click(checkbox);
  expect(checkbox).toHaveAttribute("data-state", "checked");

  fireEvent.click(checkbox);
  expect(checkbox).toHaveAttribute("data-state", "unchecked");
});

it("cycles a some-covered tag straight to all on click", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [[1, { id: 1, name: "Family" }]];
    return undefined;
  });
  renderPanel({ mediaIds: [1, 2], open: true });

  const row = (await screen.findByText("Family")).closest("label") as HTMLElement;
  const checkbox = within(row).getByRole("checkbox");
  expect(checkbox).toHaveAttribute("data-state", "indeterminate");

  fireEvent.click(checkbox);
  expect(checkbox).toHaveAttribute("data-state", "checked");
});

it("APPLY sends staged creates and add/remove overrides, and CANCEL discards them", async () => {
  let tagMediaArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_tags") {
      return [
        { id: 1, name: "Family" },
        { id: 2, name: "Beach" },
      ];
    }
    if (cmd === "tags_for_media") return [[1, { id: 2, name: "Beach" }]];
    if (cmd === "tag_media") {
      tagMediaArgs = args;
      return null;
    }
    if (cmd === "start_sidecar_sync_all") return [];
    return undefined;
  });
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1], open: true, onClose });

  await screen.findByText("Family");

  // Stage: check Family (add), uncheck Beach (remove), create a new tag.
  const familyCheckbox = within(screen.getByText("Family").closest("label") as HTMLElement).getByRole(
    "checkbox",
  );
  fireEvent.click(familyCheckbox);
  const beachCheckbox = within(screen.getByText("Beach").closest("label") as HTMLElement).getByRole(
    "checkbox",
  );
  fireEvent.click(beachCheckbox);

  fireEvent.change(screen.getByPlaceholderText(/filter or create/i), { target: { value: "Sunset" } });
  fireEvent.click(screen.getByRole("button", { name: /create "sunset"/i }));

  fireEvent.click(screen.getByRole("button", { name: /apply/i }));

  await waitFor(() =>
    expect(tagMediaArgs).toEqual({ mediaIds: [1], add: ["Sunset", "Family"], remove: [2] }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("CANCEL closes without applying anything", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1], open: true, onClose });

  const row = (await screen.findByText("Family")).closest("label") as HTMLElement;
  fireEvent.click(within(row).getByRole("checkbox"));

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

  expect(onClose).toHaveBeenCalled();
});

it("APPLY is disabled with nothing staged", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  await screen.findByText("Family");
  expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
});

it("shows an inline error when apply fails and does not close", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    if (cmd === "tag_media") throw new Error("db locked");
    return undefined;
  });
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1], open: true, onClose });

  const row = (await screen.findByText("Family")).closest("label") as HTMLElement;
  fireEvent.click(within(row).getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));

  expect(await screen.findByText("db locked")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
