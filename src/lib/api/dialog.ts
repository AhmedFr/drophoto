import { open } from "@tauri-apps/plugin-dialog";

/**
 * Opens the native "choose a folder" picker, returning the chosen path or
 * `null` if the user cancelled. Thin wrapper over
 * `@tauri-apps/plugin-dialog`'s `open`, restricted to a single directory
 * pick.
 */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, defaultPath });
  return typeof result === "string" ? result : null;
}
