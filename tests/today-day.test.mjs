import assert from "node:assert/strict";
import test from "node:test";

import { millisecondsUntilTodayRefresh, todayReviewDayKey } from "../app/today-day.ts";

test("keeps activity before 8 am in the previous review day", () => {
  assert.equal(todayReviewDayKey(new Date(2026, 7, 10, 7, 59, 59)), "2026-08-09");
  assert.equal(todayReviewDayKey(new Date(2026, 7, 10, 8, 0, 0)), "2026-08-10");
});

test("schedules the next Today refresh for 8 am local time", () => {
  assert.equal(millisecondsUntilTodayRefresh(new Date(2026, 7, 10, 7, 30, 0)), 30 * 60 * 1000);
  assert.equal(millisecondsUntilTodayRefresh(new Date(2026, 7, 10, 8, 30, 0)), 23.5 * 60 * 60 * 1000);
});
