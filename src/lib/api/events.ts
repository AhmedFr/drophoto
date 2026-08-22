import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function onEvent<T>(name: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(name, (e) => cb(e.payload));
}
