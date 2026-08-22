import { convertFileSrc } from "@tauri-apps/api/core";

export const thumbUrl = (path: string) => convertFileSrc(path);
