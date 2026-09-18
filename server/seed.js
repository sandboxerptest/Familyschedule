/**
 * First-run demo data.
 *
 * A calendar that boots up empty looks broken on a wall-mounted TV, so a fresh
 * install lands on a plausible week. Dates are generated relative to today so
 * the demo never looks stale, and everything here is editable or deletable
 * from the phone view.
 */

import { addDays, startOfWeek, todayKey } from './dates.js';
import { emptyState, validateEvent, validateMember } from './store.js';

export function seedState(today = todayKey()) {
  const state = emptyState();
  state.settings.familyName = 'The Rivera Family';

  const people = [
    { name: 'Mum', color: '#5b8def' },
    { name: 'Dad', color: '#37b3c4' },
    { name: 'Ava', color: '#ef6fb0' },
    { name: 'Noah', color: '#5ac08a' },
  ];
  for (const person of people) {
    state.members.push(validateMember(person, state.members));
  }
  const [mum, dad, ava, noah] = state.members;

  const monday = startOfWeek(today, 1);
  const drafts = [
    {
      title: 'School run',
      date: monday,
      startTime: '08:10',
      endTime: '08:40',
      category: 'school',
      memberIds: [dad.id, ava.id, noah.id],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
    },
    {
      title: 'Swimming lessons',
      date: addDays(monday, 1),
      startTime: '17:00',
      endTime: '18:00',
      location: 'Leisure centre',
      category: 'sport',
      memberIds: [noah.id],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [2] },
    },
    {
      title: 'Bin day',
      date: addDays(monday, 2),
      category: 'chore',
      notes: 'Green bin this week',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [3] },
    },
    {
      title: 'Football training',
      date: addDays(monday, 3),
      startTime: '18:30',
      endTime: '20:00',
      location: 'Riverside pitch',
      category: 'sport',
      memberIds: [ava.id],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [4] },
    },
    {
      title: 'Taco night',
      date: addDays(monday, 4),
      startTime: '18:00',
      category: 'meal',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [5] },
    },
    {
      title: 'Dentist — Ava',
      date: addDays(today, 3),
      startTime: '15:20',
      endTime: '16:00',
      location: 'High Street Dental',
      category: 'appointment',
      memberIds: [mum.id, ava.id],
    },
    {
      title: 'Grandma’s birthday',
      date: addDays(today, 9),
      category: 'birthday',
      recurrence: { freq: 'yearly', interval: 1 },
    },
    {
      title: 'Half term — Lake District',
      date: addDays(today, 16),
      endDate: addDays(today, 20),
      category: 'trip',
      memberIds: state.members.map((m) => m.id),
      notes: 'Cottage check-in from 4pm',
    },
    {
      title: 'Book club',
      date: addDays(today, 5),
      startTime: '20:00',
      category: 'activity',
      memberIds: [mum.id],
      recurrence: { freq: 'monthly', interval: 1 },
    },
  ];

  for (const draft of drafts) {
    state.events.push(validateEvent(draft, state.members));
  }

  return state;
}

export default seedState;
