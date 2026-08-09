export const TODAY_REFRESH_HOUR = 8;

type DateInput = Date | string | number;

function toDate(value: DateInput) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Returns the local review-day key for a timestamp. A review day starts at
 * 8:00 am and ends immediately before 8:00 am on the following calendar day.
 */
export function todayReviewDayKey(value: DateInput = new Date()) {
  const shifted = toDate(value);
  shifted.setHours(shifted.getHours() - TODAY_REFRESH_HOUR);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

export function millisecondsUntilTodayRefresh(value: DateInput = new Date()) {
  const current = toDate(value);
  const next = new Date(current.getTime());
  next.setHours(TODAY_REFRESH_HOUR, 0, 0, 0);
  if (next.getTime() <= current.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - current.getTime();
}

export function todayReviewDayLabel(dayKey: string, isCurrent: boolean) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const label = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return isCurrent ? `Today · ${label}` : label;
}
