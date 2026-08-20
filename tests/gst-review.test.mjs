import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("flags unregistered GST for review and gives its result card a pale-red background", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /official\.gstRegistered === false\) issues\.push\("GST is not currently registered\. Review this result before completing verification\."\)/);
  assert.match(page, /check\.issues\.length > 0 \|\| check\.official\.gstRegistered === false/);
  assert.match(page, /checkRequiresReview\(check\) && <label/);
  assert.match(styles, /\.registration-fact\.gst-inactive \{[^}]*background: #fff1ef/);
});
