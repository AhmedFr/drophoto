import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useDangerZoneActions } from "./useDangerZoneActions";

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useDangerZoneActions(), { wrapper: wrapperFor(queryClient) });
}

it("does not query get_settings, storage_usage, or tool_health on mount — Danger zone has no data query of its own", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
    return undefined;
  });

  render();
  await waitFor(() => expect(commands).toEqual([]));
});

it("confirmResetAppData surfaces reset_app_data's rejection message via resetError", async () => {
  mockIPC((cmd) => {
    if (cmd === "reset_app_data") throw { code: "io", message: "couldn't delete thumbs directory" };
    return undefined;
  });

  const { result } = render();
  expect(result.current.resetError).toBeNull();

  act(() => result.current.confirmResetAppData());

  await waitFor(() => expect(result.current.resetError).toBe("couldn't delete thumbs directory"));
});

it("confirmResetAppData calls reset_app_data and reports resetting while in flight", async () => {
  let resolveReset: () => void = () => {};
  const resetPromise = new Promise<void>((resolve) => {
    resolveReset = resolve;
  });
  mockIPC((cmd) => {
    if (cmd === "reset_app_data") return resetPromise;
    return undefined;
  });

  const { result } = render();

  act(() => result.current.confirmResetAppData());
  await waitFor(() => expect(result.current.resetting).toBe(true));

  resolveReset();
  await waitFor(() => expect(result.current.resetting).toBe(false));
});

it("confirmUninstall surfaces uninstall_app's rejection message via uninstallError", async () => {
  mockIPC((cmd) => {
    if (cmd === "uninstall_app") throw { code: "unsupported", message: "not running from an installed .app bundle" };
    return undefined;
  });

  const { result } = render();
  expect(result.current.uninstallError).toBeNull();

  act(() => result.current.confirmUninstall());

  await waitFor(() => expect(result.current.uninstallError).toBe("not running from an installed .app bundle"));
});

it("confirmUninstall calls uninstall_app and reports uninstalling while in flight", async () => {
  let resolveUninstall: () => void = () => {};
  const uninstallPromise = new Promise<void>((resolve) => {
    resolveUninstall = resolve;
  });
  mockIPC((cmd) => {
    if (cmd === "uninstall_app") return uninstallPromise;
    return undefined;
  });

  const { result } = render();

  act(() => result.current.confirmUninstall());
  await waitFor(() => expect(result.current.uninstalling).toBe(true));

  resolveUninstall();
  await waitFor(() => expect(result.current.uninstalling).toBe(false));
});
