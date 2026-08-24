import { readdir } from "node:fs/promises";

const files = (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();

for (const file of files) await import(new URL(`../tests/${file}`, import.meta.url));
