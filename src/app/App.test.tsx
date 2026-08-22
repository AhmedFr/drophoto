import { render, screen } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { App } from "./App";

it("renders the app shell and default route", async () => {
  mockIPC((cmd) => (cmd === "list_volumes" ? [] : undefined));
  render(<App />);
  expect(await screen.findByRole("heading")).toHaveTextContent("DASHBOARD");
  expect(screen.getByRole("link", { name: /gallery/i })).toBeInTheDocument();
});
