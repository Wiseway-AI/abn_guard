import { readFile } from "node:fs/promises";

// The UI is split between the server-rendered landing page, its sign-in island and the /app
// workspace. Source-level assertions read them together so they don't depend on which file holds what.
const UI_FILES = ["../app/page.tsx", "../app/landing-auth.tsx", "../app/workspace-app.tsx"];

export async function readUiSource() {
  const sources = await Promise.all(UI_FILES.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  return sources.join("\n");
}
