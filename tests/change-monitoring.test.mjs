import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("records changes only during weekly or manual monitoring checks", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const historyToggle = page.slice(page.indexOf("async function toggleAbnHistory"), page.indexOf("function persistAccounts"));

  assert.doesNotMatch(historyToggle, /compareRecord|setChanges/);
  assert.match(page, /async function refreshAll\(trigger: MonitoringTrigger\)/);
  assert.match(page, /previous\.source === "official" && current\.source === "official"/);
  assert.match(page, /compareRecord\(previous, current, trigger\)/);
  assert.match(page, /filter\(\(change\) => Boolean\(change\.trigger\)\)/);
  assert.match(page, /Weekly automatic check/);
  assert.doesNotMatch(page, /Daily automatic check|Simulate a GST change|refreshAll\(false\)|refreshAll\(true\)/);
});
