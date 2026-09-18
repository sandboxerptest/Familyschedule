/**
 * Turns stored events (one row, optional repeat rule) into the concrete
 * occurrences a calendar view needs.
 *
 * Deliberately a small subset of RFC 5545: daily / weekly (by weekday) /
 * monthly (by day-of-month) / yearly, an interval, and an end condition of
 * either `until` or `count`. That covers everything a household actually puts
 * on a fridge calendar without dragging in a full iCal engine.
 */

import {
  addDays,
  addMonths,
  addYears,
  compareKeys,
  diffDays,
  startOfWeek,
  weekday,
} from './dates.js';

export const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

/** Hard stop so a malformed rule can never spin the event loop. */
const MAX_OCCURRENCES = 2000;

/**
 * Start dates produced by an event's repeat rule, clipped to [from, to].
 * `to` bounds the search; `count`/`until` bound the rule itself.
 */
export function occurrenceDates(event, from, to) {
  const rule = normalizeRule(event.recurrence);
  const span = Math.max(0, spanDays(event) - 1);
  const results = [];

  // A multi-day event is visible on `from` even when it started earlier.
  const searchFrom = addDays(from, -span);

  if (!rule) {
    if (compareKeys(event.date, searchFrom) >= 0 && compareKeys(event.date, to) <= 0) {
      results.push(event.date);
    }
    return results;
  }

  let emitted = 0;
  let guard = 0;

  for (const candidate of ruleDates(event.date, rule)) {
    if (++guard > MAX_OCCURRENCES) break;
    if (rule.until && compareKeys(candidate, rule.until) > 0) break;
    if (rule.count && emitted >= rule.count) break;
    emitted += 1;
    if (compareKeys(candidate, to) > 0) break;
    if (compareKeys(candidate, searchFrom) < 0) continue;
    results.push(candidate);
  }

  return results;
}

/** Lazily walks every date the rule produces, starting at `start`. */
function* ruleDates(start, rule) {
  switch (rule.freq) {
    case 'daily': {
      for (let cursor = start; ; cursor = addDays(cursor, rule.interval)) yield cursor;
    }
    case 'weekly': {
      const weekdays = rule.byWeekday.length ? rule.byWeekday : [weekday(start)];
      const sorted = [...new Set(weekdays)].sort((a, b) => a - b);
      const anchor = startOfWeek(start, 0);
      for (let week = anchor; ; week = addDays(week, 7 * rule.interval)) {
        for (const day of sorted) {
          const candidate = addDays(week, day);
          if (compareKeys(candidate, start) < 0) continue;
          yield candidate;
        }
      }
    }
    case 'monthly': {
      for (let step = 0; ; step += rule.interval) {
        const { key, clamped } = addMonths(start, step);
        // Skip months that have no such day (the 31st of February), matching
        // iCal BYMONTHDAY semantics rather than silently sliding the date.
        if (!clamped) yield key;
      }
    }
    case 'yearly': {
      for (let step = 0; ; step += rule.interval) {
        const { key, clamped } = addYears(start, step);
        if (!clamped) yield key;
      }
    }
    default:
      yield start;
  }
}

export function normalizeRule(recurrence) {
  if (!recurrence) return null;
  const freq = FREQUENCIES.includes(recurrence.freq) ? recurrence.freq : 'none';
  if (freq === 'none') return null;
  const interval = Number.isInteger(recurrence.interval) && recurrence.interval > 0
    ? Math.min(recurrence.interval, 52)
    : 1;
  const byWeekday = Array.isArray(recurrence.byWeekday)
    ? recurrence.byWeekday.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  const count = Number.isInteger(recurrence.count) && recurrence.count > 0
    ? Math.min(recurrence.count, MAX_OCCURRENCES)
    : null;
  const until = typeof recurrence.until === 'string' && recurrence.until ? recurrence.until : null;
  return { freq, interval, byWeekday, until, count };
}

export function spanDays(event) {
  if (!event.endDate) return 1;
  const days = diffDays(event.date, event.endDate) + 1;
  return days > 0 ? Math.min(days, 366) : 1;
}

/**
 * Expands one event into per-day slices between `from` and `to` (inclusive).
 * A three-day trip yields three slices so every view can simply group by date.
 */
export function expandEvent(event, from, to) {
  const exceptions = new Set(event.exceptions || []);
  const total = spanDays(event);
  const slices = [];

  for (const occurrenceDate of occurrenceDates(event, from, to)) {
    if (exceptions.has(occurrenceDate)) continue;

    for (let dayIndex = 0; dayIndex < total; dayIndex += 1) {
      const date = addDays(occurrenceDate, dayIndex);
      if (compareKeys(date, from) < 0 || compareKeys(date, to) > 0) continue;
      slices.push({
        id: `${event.id}:${occurrenceDate}:${dayIndex}`,
        eventId: event.id,
        occurrenceDate,
        date,
        dayIndex,
        dayCount: total,
        isStart: dayIndex === 0,
        isEnd: dayIndex === total - 1,
        title: event.title,
        startTime: dayIndex === 0 ? event.startTime : null,
        endTime: dayIndex === total - 1 ? event.endTime : null,
        allDay: !event.startTime,
        memberIds: event.memberIds || [],
        category: event.category,
        location: event.location || '',
        notes: event.notes || '',
        repeats: Boolean(normalizeRule(event.recurrence)),
      });
    }
  }

  return slices;
}

/** Expands a list of events and returns slices sorted for display. */
export function expandEvents(events, from, to) {
  const slices = events.flatMap((event) => expandEvent(event, from, to));
  return slices.sort(compareSlices);
}

export function compareSlices(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.startTime !== b.startTime) return (a.startTime || '') < (b.startTime || '') ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** Groups slices into `{ date, items }` buckets for every day in the range. */
export function groupByDate(slices, dates) {
  const buckets = new Map(dates.map((date) => [date, []]));
  for (const slice of slices) {
    const bucket = buckets.get(slice.date);
    if (bucket) bucket.push(slice);
  }
  return [...buckets].map(([date, items]) => ({ date, items }));
}
