import { revealItemInDir } from "@tauri-apps/plugin-opener";

export const revealInFinder = (path: string) => revealItemInDir(path);
