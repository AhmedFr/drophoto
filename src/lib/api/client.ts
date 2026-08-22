import { invoke } from "@tauri-apps/api/core";

export type ApiErrorShape = { code: string; message: string; path?: string | null };

export class ApiError extends Error {
  code: string;
  path?: string | null;

  constructor(e: ApiErrorShape) {
    super(e.message);
    this.code = e.code;
    this.path = e.path;
  }
}

export async function invokeApi<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e) throw new ApiError(e as ApiErrorShape);
    throw e;
  }
}
