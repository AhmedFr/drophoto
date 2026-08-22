import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { OrganizeRule } from "@/lib/api/organize";
import { useRule } from "./useRule";

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function rule(driveId: number, overrides: Partial<OrganizeRule> = {}): OrganizeRule {
  return {
    drive_id: driveId,
    root: "archive",
    folder_tpl: "{{yyyy}}/Q{{q}}",
    file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
    keep_pairs: true,
    ...overrides,
  };
}

it("loads the active drive's rule (defaulting to the first drive)", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "get_rule") return rule((args as { driveId: number }).driveId);
    return undefined;
  });

  const queryClient = new QueryClient();
  const { result } = renderHook(() => useRule([7, 8]), { wrapper: wrapperFor(queryClient) });

  await waitFor(() => expect(result.current.rule).toEqual(rule(7)));
  expect(result.current.activeDriveId).toBe(7);
});

it("switching the active drive loads that drive's rule", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "get_rule") return rule((args as { driveId: number }).driveId);
    return undefined;
  });

  const queryClient = new QueryClient();
  const { result } = renderHook(() => useRule([7, 8]), { wrapper: wrapperFor(queryClient) });
  await waitFor(() => expect(result.current.rule).toEqual(rule(7)));

  act(() => result.current.setActiveDriveId(8));
  await waitFor(() => expect(result.current.rule).toEqual(rule(8)));
});

it("onChange updates the local draft without saving", async () => {
  mockIPC((cmd, args) => (cmd === "get_rule" ? rule((args as { driveId: number }).driveId) : undefined));

  const queryClient = new QueryClient();
  const { result } = renderHook(() => useRule([7]), { wrapper: wrapperFor(queryClient) });
  await waitFor(() => expect(result.current.rule).toEqual(rule(7)));

  act(() => result.current.onChange({ ...rule(7), root: "edited" }));
  expect(result.current.rule?.root).toBe("edited");
});

it("onSave calls save_rule with the draft and invalidates the rule and plan queries", async () => {
  const saveRuleSpy = vi.fn();
  mockIPC((cmd, args) => {
    if (cmd === "get_rule") return rule((args as { driveId: number }).driveId);
    if (cmd === "save_rule") return saveRuleSpy(args);
    return undefined;
  });

  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(() => useRule([7, 8]), { wrapper: wrapperFor(queryClient) });
  await waitFor(() => expect(result.current.rule).toEqual(rule(7)));

  act(() => result.current.onChange({ ...rule(7), root: "edited" }));
  act(() => result.current.onSave());

  await waitFor(() => expect(saveRuleSpy).toHaveBeenCalledWith({ rule: { ...rule(7), root: "edited" } }));
  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rule", 7] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["plan", [7, 8]] });
  });
});

it("surfaces a save_rule validation error inline", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "get_rule") return rule((args as { driveId: number }).driveId);
    if (cmd === "save_rule") throw { code: "unsupported", message: "root must not start with '/'" };
    return undefined;
  });

  const queryClient = new QueryClient();
  const { result } = renderHook(() => useRule([7]), { wrapper: wrapperFor(queryClient) });
  await waitFor(() => expect(result.current.rule).toEqual(rule(7)));

  act(() => result.current.onSave());

  await waitFor(() => expect(result.current.error).toBe("root must not start with '/'"));
});
