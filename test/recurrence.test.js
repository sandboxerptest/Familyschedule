import test from 'node:test';
import assert from 'node:assert/strict';

import { expandEvent, expandEvents, groupByDate, occurrenceDates } from '../server/recurrence.js';
import { rangeKeys } from '../server/dates.js';

const base = {
  id: 'e1',
  title: 'Swim',
  date: '2026-09-01', // a Tuesday
  endDate: null,
  startTime: '17:00',
  endTime: '18:00',
  memberIds: [],
  category: 'sport',
  exceptions: [],
  recurrence: null,
};

test('a one-off only appears on its own date', () => {
  assert.deepEqual(occurrenceDates(base, '2026-08-25', '2026-09-08'), ['2026-09-01']);
  assert.deepEqual(occurrenceDates(base, '2026-09-02', '2026-09-30'), []);
});

test('daily repeats respect the interval', () => {
  const event = { ...base, recurrence: { freq: 'daily', interval: 3 } };
  assert.deepEqual(occurrenceDates(event, '2026-09-01', '2026-09-10'), [
    '2026-09-01', '2026-09-04', '2026-09-07', '2026-09-10',
  ]);
});

test('weekly repeats fan out across the chosen weekdays', () => {
  const event = { ...base, recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] } };
  assert.deepEqual(occurrenceDates(event, '2026-09-01', '2026-09-12'), [
    '2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09', '2026-09-11',
  ]);
});

test('fortnightly repeats skip the in-between week', () => {
  const event = { ...base, recurrence: { freq: 'weekly', interval: 2, byWeekday: [2] } };
  assert.deepEqual(occurrenceDates(event, '2026-09-01', '2026-10-15'), [
    '2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13',
  ]);
});

test('monthly repeats skip months without the day rather than sliding', () => {
  const event = { ...base, date: '2026-01-31', recurrence: { freq: 'monthly', interval: 1 } };
  assert.deepEqual(occurrenceDates(event, '2026-01-01', '2026-06-01'), [
    '2026-01-31', '2026-03-31', '2026-05-31',
  ]);
});

test('yearly repeats survive leap days', () => {
  const event = { ...base, date: '2024-02-29', recurrence: { freq: 'yearly', interval: 1 } };
  assert.deepEqual(occurrenceDates(event, '2024-01-01', '2029-12-31'), ['2024-02-29', '2028-02-29']);
});

test('until ends the series inclusively', () => {
  const event = {
    ...base,
    recurrence: { freq: 'daily', interval: 1, until: '2026-09-03' },
  };
  assert.deepEqual(occurrenceDates(event, '2026-09-01', '2026-09-30'), [
    '2026-09-01', '2026-09-02', '2026-09-03',
  ]);
});

test('count limits the series even when the window is wider', () => {
  const event = { ...base, recurrence: { freq: 'daily', interval: 1, count: 2 } };
  assert.deepEqual(occurrenceDates(event, '2026-09-01', '2026-09-30'), ['2026-09-01', '2026-09-02']);
});

test('count is measured from the start, not from the window', () => {
  const event = { ...base, recurrence: { freq: 'daily', interval: 1, count: 3 } };
  assert.deepEqual(occurrenceDates(event, '2026-09-03', '2026-09-30'), ['2026-09-03']);
});

test('exceptions remove a single occurrence', () => {
  const event = {
    ...base,
    recurrence: { freq: 'weekly', interval: 1, byWeekday: [2] },
    exceptions: ['2026-09-08'],
  };
  const dates = expandEvent(event, '2026-09-01', '2026-09-22').map((slice) => slice.date);
  assert.deepEqual(dates, ['2026-09-01', '2026-09-15', '2026-09-22']);
});

test('multi-day events produce one slice per covered day', () => {
  const trip = {
    ...base,
    title: 'Lake District',
    startTime: null,
    endTime: null,
    date: '2026-09-04',
    endDate: '2026-09-06',
  };
  const slices = expandEvent(trip, '2026-09-01', '2026-09-30');
  assert.deepEqual(slices.map((s) => s.date), ['2026-09-04', '2026-09-05', '2026-09-06']);
  assert.deepEqual(slices.map((s) => s.dayIndex), [0, 1, 2]);
  assert.equal(slices[0].isStart, true);
  assert.equal(slices[2].isEnd, true);
  assert.equal(slices.every((s) => s.dayCount === 3), true);
});

test('a multi-day event still shows on days after its start date fell out of range', () => {
  const trip = { ...base, startTime: null, date: '2026-09-04', endDate: '2026-09-08' };
  const slices = expandEvent(trip, '2026-09-06', '2026-09-07');
  assert.deepEqual(slices.map((s) => s.date), ['2026-09-06', '2026-09-07']);
});

test('all-day events sort above timed ones, then by start time', () => {
  const events = [
    { ...base, id: 'a', title: 'Late', startTime: '19:00' },
    { ...base, id: 'b', title: 'Holiday', startTime: null, endTime: null },
    { ...base, id: 'c', title: 'Early', startTime: '07:30' },
  ];
  const slices = expandEvents(events, '2026-09-01', '2026-09-01');
  assert.deepEqual(slices.map((s) => s.title), ['Holiday', 'Early', 'Late']);
});

test('grouping keeps empty days in the range', () => {
  const slices = expandEvents([base], '2026-09-01', '2026-09-03');
  const grouped = groupByDate(slices, rangeKeys('2026-09-01', '2026-09-03'));
  assert.deepEqual(grouped.map((day) => day.items.length), [1, 0, 0]);
});

test('a malformed rule cannot loop forever', () => {
  const event = { ...base, recurrence: { freq: 'daily', interval: 0 } };
  const dates = occurrenceDates(event, '2026-09-01', '2026-09-05');
  assert.deepEqual(dates, ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
});
