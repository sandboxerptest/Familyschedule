/**
 * Calendar math on plain local dates.
 *
 * Hearth stores wall-clock values: a date key is "YYYY-MM-DD" and a time is
 * "HH:MM". Nothing is stored in UTC, because a family calendar is inherently
 * local — "dinner at 6" stays at 6 no matter what the server thinks the
 * timezone is. All arithmetic below runs through Date.UTC so daylight saving
 * transitions can never shift a day boundary.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  return toKey(fromKey(value)) === value;
}

export function isTimeKey(value) {
  return typeof value === 'string' && TIME_KEY.test(value);
}

/** "YYYY-MM-DD" -> Date anchored at UTC midnight. */
export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date -> "YYYY-MM-DD". */
export function toKey(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(key, amount) {
  const date = fromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return toKey(date);
}

export function addMonths(key, amount) {
  const date = fromKey(key);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const lastDay = daysInMonth(date.getUTCFullYear(), date.getUTCMonth());
  date.setUTCDate(Math.min(day, lastDay));
  return { key: toKey(date), clamped: day > lastDay };
}

export function addYears(key, amount) {
  const date = fromKey(key);
  const day = date.getUTCDate();
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + amount);
  const clamped = date.getUTCDate() !== day || date.getUTCMonth() !== month;
  return { key: toKey(date), clamped };
}

export function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(key) {
  return fromKey(key).getUTCDay();
}

export function diffDays(fromKeyValue, toKeyValue) {
  return Math.round((fromKey(toKeyValue) - fromKey(fromKeyValue)) / 86400000);
}

export function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Start of the week containing `key`, where `weekStart` is 0 (Sun) or 1 (Mon). */
export function startOfWeek(key, weekStart = 0) {
  const offset = (weekday(key) - weekStart + 7) % 7;
  return addDays(key, -offset);
}

export function minutesOf(time) {
  if (!isTimeKey(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Local "now" as { date, time } wall-clock strings for a given Date. */
export function wallClock(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function todayKey() {
  return wallClock().date;
}

export function rangeKeys(from, to) {
  const keys = [];
  for (let key = from; compareKeys(key, to) <= 0; key = addDays(key, 1)) keys.push(key);
  return keys;
}
