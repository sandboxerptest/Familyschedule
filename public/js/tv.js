/**
 * The kitchen TV view.
 *
 * Runs unattended for weeks: it re-renders on live server events, rolls over
 * at midnight, survives the wifi dropping out, and nudges its own layout every
 * few minutes so a static screen cannot ghost the panel.
 */

import { api, subscribe } from './api.js';
import {
  addDays,
  categoryMeta,
  dayName,
  formatRange,
  formatTime,
  longDate,
  minutesOf,
  nowMinutes,
  todayKey,
  untilLabel,
  weekdayIndex,
} from './format.js';

const CATEGORY_TINT = {
  general: '#74a5ff',
  school: '#f5a524',
  sport: '#5ac08a',
  activity: '#f2d13d',
  appointment: '#37b3c4',
  meal: '#f97362',
  chore: '#9b7bf0',
  birthday: '#ef6fb0',
  trip: '#5b8def',
};

const REFRESH_MS = 5 * 60 * 1000;
const WEATHER_MS = 15 * 60 * 1000;
const BURN_IN_MS = 8 * 60 * 1000;
const AGENDA_DAYS = 6;

const el = {
  root: document.documentElement,
  tv: document.getElementById('tv'),
  familyName: document.getElementById('familyName'),
  todayLong: document.getElementById('todayLong'),
  clock: document.getElementById('clock'),
  weather: document.getElementById('weather'),
  main: document.getElementById('main'),
  todayHeading: document.getElementById('todayHeading'),
  todayCount: document.getElementById('todayCount'),
  spotlight: document.getElementById('spotlight'),
  spotlightKind: document.getElementById('spotlightKind'),
  spotlightTitle: document.getElementById('spotlightTitle'),
  spotlightMeta: document.getElementById('spotlightMeta'),
  todayList: document.getElementById('todayList'),
  whoNext: document.getElementById('whoNext'),
  board: document.getElementById('board'),
  legend: document.getElementById('legend'),
  editUrl: document.getElementById('editUrl'),
  status: document.getElementById('status'),
};

const state = {
  settings: null,
  members: new Map(),
  days: [],
  today: todayKey(),
  mode: 'agenda',
  lastMinute: -1,
};

boot();

async function boot() {
  el.editUrl.textContent = `${location.host}/edit`;
  await refresh();

  subscribe({
    onChange: () => scheduleRefresh(250),
    onStatus: (status) => el.status.setAttribute('data-state', status),
  });

  setInterval(tick, 1000);
  setInterval(() => refresh(), REFRESH_MS);
  setInterval(loadWeather, WEATHER_MS);
  setInterval(shiftPixels, BURN_IN_MS);
  tick();

  document.addEventListener('keydown', onKey);
  document.addEventListener('mousemove', showCursorBriefly);
}

let refreshTimer = null;
function scheduleRefresh(delay) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(), delay);
}

async function refresh() {
  try {
    const today = todayKey();
    const from = startOfWeekKey(today, state.settings?.weekStart ?? 1);
    const payload = await api.calendar(from, addDays(from, 20));

    state.settings = payload.settings;
    state.today = payload.today;
    state.members = new Map(payload.members.map((member) => [member.id, member]));
    state.days = payload.days;

    el.root.dataset.theme = payload.settings.theme;
    el.familyName.textContent = payload.settings.familyName;
    el.todayLong.textContent = longDate(payload.today);

    renderLegend();
    render();
    el.status.setAttribute('data-state', 'live');
    loadWeather();
  } catch {
    el.status.setAttribute('data-state', 'reconnecting');
  }
}

function render() {
  renderToday();
  renderBoard();
}

// -- today ----------------------------------------------------------------

function renderToday() {
  const day = state.days.find((d) => d.date === state.today);
  const items = day ? day.items : [];
  const minutes = nowMinutes();

  el.todayCount.textContent = items.length
    ? `${items.length} ${items.length === 1 ? 'thing' : 'things'} on`
    : '';

  el.todayList.replaceChildren(
    ...(items.length
      ? items.map((item) => todayRow(item, minutes))
      : [emptyState('A clear day', 'Nothing scheduled — enjoy it.')]),
  );

  renderSpotlight(items, minutes);
  renderWhoNext(minutes);
  requestAnimationFrame(() => trimOverflow(el.todayList));
}

function todayRow(item, minutes) {
  const li = document.createElement('li');
  li.className = 'today-item';
  li.style.setProperty('--tint', tintFor(item));

  const start = minutesOf(item.startTime);
  const end = minutesOf(item.endTime);
  if (start !== null) {
    const finish = end ?? start + 60;
    if (start <= minutes && minutes < finish) li.classList.add('is-now');
    else if (finish <= minutes) li.classList.add('is-past');
  }

  const when = document.createElement('div');
  when.className = 'when';
  if (item.allDay) {
    when.textContent = item.dayCount > 1 ? `Day ${item.dayIndex + 1}` : 'All day';
  } else {
    when.textContent = formatTime(item.startTime, state.settings.clock24h);
    if (item.endTime) {
      const small = document.createElement('small');
      small.textContent = `to ${formatTime(item.endTime, state.settings.clock24h)}`;
      when.append(small);
    }
  }

  const what = document.createElement('div');
  what.className = 'what';

  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = item.title;

  const sub = document.createElement('p');
  sub.className = 'sub';
  const bits = [];
  const meta = categoryMeta(item.category);
  if (item.category !== 'general') bits.push(`${meta.glyph} ${meta.label}`);
  if (item.location) bits.push(`📍 ${item.location}`);
  if (bits.length) sub.append(document.createTextNode(bits.join('  ·  ')));
  const people = peopleTags(item);
  if (people) sub.append(people);

  what.append(title);
  if (sub.childNodes.length) what.append(sub);
  li.append(when, what);
  return li;
}

function renderSpotlight(items, minutes) {
  const timed = items.filter((item) => item.startTime);

  const running = timed.find((item) => {
    const start = minutesOf(item.startTime);
    const end = minutesOf(item.endTime) ?? start + 60;
    return start <= minutes && minutes < end;
  });

  const next = timed.find((item) => minutesOf(item.startTime) > minutes);
  // Evenings would otherwise leave a hole where the spotlight is, so once
  // today is done we look ahead to the next day that has anything on it.
  const ahead = running || next ? null : nextDayHighlight();
  const focus = running || next || ahead?.item;

  if (!focus) {
    el.spotlight.hidden = true;
    return;
  }

  el.spotlight.hidden = false;
  el.spotlightKind.replaceChildren();
  if (running) {
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    el.spotlightKind.append(dot, document.createTextNode('Happening now'));
  } else if (next) {
    el.spotlightKind.textContent = `Up next · ${untilLabel(minutesOf(focus.startTime) - minutes)}`;
  } else {
    el.spotlightKind.textContent = `First thing ${ahead.label}`;
  }

  el.spotlightTitle.textContent = focus.title;
  const parts = [
    focus.allDay ? 'All day' : formatRange(focus.startTime, focus.endTime, state.settings.clock24h),
  ];
  if (focus.location) parts.push(focus.location);
  const names = focus.memberIds.map((id) => state.members.get(id)?.name).filter(Boolean);
  if (names.length) parts.push(names.join(' & '));
  el.spotlightMeta.textContent = parts.join('  ·  ');
}

/**
 * One line per person: the next thing they personally have on. This is the
 * question a kitchen calendar gets asked most often ("what have I got today?"),
 * and it keeps the panel useful on a quiet evening.
 */
function renderWhoNext(minutes) {
  const members = [...state.members.values()];
  if (!members.length) {
    el.whoNext.hidden = true;
    return;
  }

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Next up';

  el.whoNext.hidden = false;
  el.whoNext.replaceChildren(eyebrow, ...members.map((member) => whoRow(member, minutes)));
}

function whoRow(member, minutes) {
  const next = findNextFor(member.id, minutes);
  const row = document.createElement('div');
  row.className = next ? 'who-row' : 'who-row is-free';

  const name = document.createElement('span');
  name.className = 'who-name';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.setProperty('--dot', member.color);
  name.append(dot, document.createTextNode(` ${member.name}`));

  const what = document.createElement('span');
  what.className = 'who-what';
  what.textContent = next ? next.item.title : 'Nothing booked';

  const when = document.createElement('span');
  when.className = 'who-when';
  when.textContent = next ? whenLabel(next.item) : '';

  row.append(name, what, when);
  return row;
}

function findNextFor(memberId, minutes) {
  const index = state.days.findIndex((day) => day.date === state.today);
  if (index === -1) return null;
  for (const day of state.days.slice(index)) {
    for (const item of day.items) {
      if (!item.memberIds.includes(memberId)) continue;
      // Skip anything already finished today.
      if (day.date === state.today && item.startTime) {
        const end = minutesOf(item.endTime) ?? minutesOf(item.startTime) + 60;
        if (end <= minutes) continue;
      }
      return { day, item };
    }
  }
  return null;
}

function whenLabel(item) {
  const time = item.allDay ? '' : formatTime(item.startTime, state.settings.clock24h);
  if (item.date === state.today) return time || 'Today';
  const day = dayName(item.date, 'short');
  return time ? `${day} ${time}` : day;
}

/** The first entry on the next day that has anything scheduled. */
function nextDayHighlight() {
  const index = state.days.findIndex((day) => day.date === state.today);
  if (index === -1) return null;
  for (const day of state.days.slice(index + 1, index + 8)) {
    if (day.items.length) {
      return { item: day.items[0], label: relativeLabel(day.date) };
    }
  }
  return null;
}

function relativeLabel(date) {
  const diff = Math.round((new Date(`${date}T00:00:00`) - new Date(`${state.today}T00:00:00`)) / 86400000);
  if (diff === 1) return 'tomorrow';
  return `on ${dayName(date, 'long')}`;
}

// -- board ----------------------------------------------------------------

function renderBoard() {
  const days = state.mode === 'week' ? weekDays() : upcomingDays();
  el.board.replaceChildren(...days.map(dayColumn));
  requestAnimationFrame(() => {
    for (const list of el.board.querySelectorAll('.day-items')) trimOverflow(list);
  });
}

function upcomingDays() {
  const index = state.days.findIndex((day) => day.date === state.today);
  const start = index === -1 ? 0 : index + 1;
  return state.days.slice(start, start + AGENDA_DAYS);
}

function weekDays() {
  const start = startOfWeekKey(state.today, state.settings.weekStart);
  const index = state.days.findIndex((day) => day.date === start);
  return index === -1 ? state.days.slice(0, 7) : state.days.slice(index, index + 7);
}

function dayColumn(day) {
  const section = document.createElement('div');
  section.className = 'day-col fade-in';
  if (day.date === state.today) section.classList.add('is-today');
  else if (day.date < state.today) section.classList.add('is-past');
  const weekday = weekdayIndex(day.date);
  if (weekday === 0 || weekday === 6) section.classList.add('is-weekend');

  const head = document.createElement('div');
  head.className = 'day-head';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = day.date === state.today ? 'Today' : dayName(day.date, 'short');
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(Number(day.date.slice(8)));
  head.append(name, num);

  const list = document.createElement('div');
  list.className = 'day-items';
  if (day.items.length) {
    list.append(...day.items.map(miniCard));
  } else {
    list.append(emptyState('', 'Free'));
  }

  section.append(head, list);
  return section;
}

function miniCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  if (item.dayCount > 1) card.classList.add('is-span');
  card.style.setProperty('--tint', tintFor(item));

  const time = document.createElement('p');
  time.className = 'time';
  const meta = categoryMeta(item.category);
  time.textContent = item.allDay
    ? `${meta.glyph} ${item.dayCount > 1 ? `Day ${item.dayIndex + 1}/${item.dayCount}` : 'All day'}`
    : `${meta.glyph} ${formatTime(item.startTime, state.settings.clock24h)}`;

  const name = document.createElement('p');
  name.className = 'name';
  name.textContent = item.title;

  card.append(time, name);
  const people = peopleTags(item, 'who');
  if (people) card.append(people);
  return card;
}

// -- shared bits ----------------------------------------------------------

function peopleTags(item, className = 'people') {
  if (!item.memberIds.length) return null;
  const wrap = document.createElement('span');
  wrap.className = className;
  for (const id of item.memberIds) {
    const member = state.members.get(id);
    if (!member) continue;
    const tag = document.createElement('span');
    tag.className = 'person-tag';
    tag.style.setProperty('--tint', member.color);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--dot', member.color);
    tag.append(dot, document.createTextNode(member.name));
    wrap.append(tag);
  }
  return wrap.childNodes.length ? wrap : null;
}

function tintFor(item) {
  const member = item.memberIds.map((id) => state.members.get(id)).find(Boolean);
  return member ? member.color : CATEGORY_TINT[item.category] || CATEGORY_TINT.general;
}

function emptyState(big, text) {
  const wrap = document.createElement('li');
  wrap.className = 'empty';
  if (big) {
    const strong = document.createElement('span');
    strong.className = 'big';
    strong.textContent = big;
    wrap.append(strong);
  }
  wrap.append(document.createTextNode(text));
  return wrap;
}

function renderLegend() {
  el.legend.replaceChildren(
    ...[...state.members.values()].map((member) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--dot', member.color);
      li.append(dot, document.createTextNode(member.name));
      return li;
    }),
  );
}

/**
 * Hides whatever does not fit a column and adds a "+N more" marker, so a busy
 * Saturday degrades gracefully instead of spilling off the screen.
 */
function trimOverflow(list) {
  const existing = list.querySelector('.more');
  if (existing) existing.remove();
  const items = [...list.children];
  for (const item of items) item.hidden = false;

  const bounds = list.getBoundingClientRect();
  const overflowing = items.filter((item) => item.getBoundingClientRect().bottom > bounds.bottom - 2);
  if (!overflowing.length) return;

  // Reserve a line for the marker itself before deciding what to drop.
  const reserve = 22;
  const visible = items.filter((item) => item.getBoundingClientRect().bottom <= bounds.bottom - reserve);
  const hiddenCount = items.length - visible.length;
  if (!hiddenCount) return;

  for (const item of items.slice(visible.length)) item.hidden = true;

  const more = document.createElement(list.tagName === 'UL' ? 'li' : 'div');
  more.className = 'more';
  more.textContent = `+${hiddenCount} more`;
  list.append(more);
}

// -- weather ---------------------------------------------------------------

async function loadWeather() {
  if (!state.settings?.weather?.enabled) {
    el.weather.hidden = true;
    return;
  }
  try {
    const { weather } = await api.weather();
    if (!weather) {
      el.weather.hidden = true;
      return;
    }
    renderWeather(weather);
  } catch {
    el.weather.hidden = true;
  }
}

const WEATHER_GLYPH = {
  clear: '☀️', partly: '🌤️', cloudy: '☁️', fog: '🌫️',
  drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️',
};

function renderWeather(weather) {
  const icon = document.createElement('span');
  icon.className = 'weather-icon glyph';
  icon.textContent = WEATHER_GLYPH[weather.now.icon] || '☁️';

  const block = document.createElement('div');
  const temp = document.createElement('p');
  temp.className = 'temp';
  temp.textContent = weather.now.temperature === null ? '—' : `${weather.now.temperature}${weather.unit}`;
  const cond = document.createElement('p');
  cond.className = 'cond';
  cond.textContent = weather.label ? `${weather.now.label} · ${weather.label}` : weather.now.label;
  block.append(temp, cond);

  const forecast = document.createElement('div');
  forecast.className = 'forecast';
  for (const day of weather.days.slice(1, 4)) {
    const cell = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${WEATHER_GLYPH[day.icon] || '☁️'} ${day.high ?? '—'}°`;
    cell.append(strong, document.createTextNode(dayName(day.date, 'short')));
    forecast.append(cell);
  }

  el.weather.replaceChildren(icon, block);
  if (forecast.childNodes.length) el.weather.append(forecast);
  el.weather.hidden = false;
}

// -- ticking ---------------------------------------------------------------

function tick() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const use24 = state.settings?.clock24h;

  const display = use24 ? String(hours).padStart(2, '0') : String(hours % 12 === 0 ? 12 : hours % 12);
  el.clock.replaceChildren(document.createTextNode(`${display}:${String(minutes).padStart(2, '0')}`));
  if (!use24) {
    const meridiem = document.createElement('span');
    meridiem.className = 'meridiem';
    meridiem.textContent = hours >= 12 ? 'pm' : 'am';
    el.clock.append(meridiem);
  }

  if (minutes === state.lastMinute) return;
  state.lastMinute = minutes;

  if (todayKey() !== state.today) {
    refresh();
    return;
  }
  if (state.settings) renderToday();
  rotateIfDue(now);
}

let lastRotate = Date.now();
function rotateIfDue(now) {
  const seconds = state.settings?.rotateSeconds || 0;
  if (!seconds) return;
  if (now.getTime() - lastRotate < seconds * 1000) return;
  lastRotate = now.getTime();
  setMode(state.mode === 'agenda' ? 'week' : 'agenda');
}

function setMode(mode) {
  state.mode = mode;
  el.main.dataset.mode = mode;
  renderBoard();
}

function shiftPixels() {
  const x = (Math.random() * 8 - 4).toFixed(1);
  const y = (Math.random() * 8 - 4).toFixed(1);
  el.tv.style.setProperty('--burn-x', `${x}px`);
  el.tv.style.setProperty('--burn-y', `${y}px`);
}

function startOfWeekKey(key, weekStart = 1) {
  const offset = (weekdayIndex(key) - weekStart + 7) % 7;
  return addDays(key, -offset);
}

// -- input -----------------------------------------------------------------

function onKey(event) {
  switch (event.key.toLowerCase()) {
    case 'v':
      setMode(state.mode === 'agenda' ? 'week' : 'agenda');
      break;
    case 'f':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
    case 'r':
      refresh();
      break;
    case 'e':
      location.href = '/edit';
      break;
    default:
      break;
  }
}

let cursorTimer = null;
function showCursorBriefly() {
  document.body.classList.add('show-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 3000);
}
