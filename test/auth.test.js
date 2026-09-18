import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../server/app.js';
import { createAuth, readCookie, SESSION_COOKIE } from '../server/auth.js';
import { Store } from '../server/store.js';

async function withServer(options, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hearth-auth-'));
  const store = new Store(path.join(dir, 'calendar.json'));
  await store.load();
  const server = createApp(store, { weather: { get: async () => null }, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = (pathname, init = {}) =>
    fetch(`${base}${pathname}`, {
      redirect: 'manual',
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  try {
    await run({ call, store, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
}

test('with no passcode configured nothing is gated', async () => {
  await withServer({ auth: createAuth({ pin: '' }) }, async ({ call }) => {
    assert.equal((await call('/api/bootstrap')).status, 200);
    assert.equal((await call('/')).status, 200);

    const session = await (await call('/api/session')).json();
    assert.deepEqual(session, { required: false, authenticated: true });

    const bootstrap = await (await call('/api/bootstrap')).json();
    assert.equal(bootstrap.authEnabled, false);
  });
});

test('with a passcode set the calendar is closed until you sign in', async () => {
  await withServer({ auth: createAuth({ pin: '2468' }) }, async ({ call }) => {
    const api = await call('/api/calendar');
    assert.equal(api.status, 401);

    const page = await call('/edit');
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login?next=%2Fedit');

    // The sign-in page and its assets must stay reachable, and the health
    // probe has to answer for the platform's load balancer.
    assert.equal((await call('/login')).status, 200);
    assert.equal((await call('/css/base.css')).status, 200);
    assert.equal((await call('/js/login.js')).status, 200);
    assert.equal((await call('/api/health')).status, 200);
  });
});

test('the right passcode issues a session cookie that unlocks the app', async () => {
  await withServer({ auth: createAuth({ pin: '2468' }) }, async ({ call }) => {
    const wrong = await call('/api/session', { method: 'POST', body: { pin: '1111' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const right = await call('/api/session', { method: 'POST', body: { pin: '2468' } });
    assert.equal(right.status, 200);
    const cookie = right.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/, 'plain http must not set a Secure cookie');

    const token = readCookie(cookie.split(';')[0], SESSION_COOKIE);
    const allowed = await call('/api/calendar', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    assert.equal(allowed.status, 200);

    const signedOut = await call('/api/session', {
      method: 'DELETE',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/);
  });
});

test('behind an https proxy the cookie is marked Secure', async () => {
  await withServer({ auth: createAuth({ pin: '2468' }) }, async ({ call }) => {
    const response = await call('/api/session', {
      method: 'POST',
      body: { pin: '2468' },
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    assert.match(response.headers.get('set-cookie'), /Secure/);
  });
});

test('guessing is throttled per client', async () => {
  await withServer({ auth: createAuth({ pin: '2468' }) }, async ({ call }) => {
    const guess = (ip) =>
      call('/api/session', {
        method: 'POST',
        body: { pin: '0000' },
        headers: { 'X-Forwarded-For': ip },
      });

    let last;
    for (let i = 0; i < 8; i += 1) last = await guess('203.0.113.5');
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);

    // A different household device is unaffected by one phone's fat fingers.
    assert.equal((await guess('203.0.113.9')).status, 401);

    // And the throttle still refuses even when the passcode is finally right.
    const correct = await call('/api/session', {
      method: 'POST',
      body: { pin: '2468' },
      headers: { 'X-Forwarded-For': '203.0.113.5' },
    });
    assert.equal(correct.status, 429);
  });
});

test('forged and expired cookies are rejected', async () => {
  const auth = createAuth({ pin: '2468' });
  const fake = { headers: { cookie: `${SESSION_COOKIE}=${Date.now()}.deadbeef` } };
  assert.equal(auth.isAuthenticated(fake), false);
  assert.equal(auth.isAuthenticated({ headers: {} }), false);

  // A cookie minted a year and a day ago is past its life.
  const old = createAuth({ pin: '2468', maxAgeDays: 1, now: () => 0 });
  const cookie = old.cookie({ secure: false });
  const token = readCookie(cookie.split(';')[0], SESSION_COOKIE);
  const later = createAuth({ pin: '2468', maxAgeDays: 1, now: () => 2 * 86400000 });
  assert.equal(later.isAuthenticated({ headers: { cookie: `${SESSION_COOKIE}=${token}` } }), false);
});

test('changing the passcode invalidates existing sessions', async () => {
  const before = createAuth({ pin: '2468' });
  const cookie = before.cookie({ secure: false });
  const token = readCookie(cookie.split(';')[0], SESSION_COOKIE);
  const after = createAuth({ pin: '1357' });
  assert.equal(before.isAuthenticated({ headers: { cookie: `${SESSION_COOKIE}=${token}` } }), true);
  assert.equal(after.isAuthenticated({ headers: { cookie: `${SESSION_COOKIE}=${token}` } }), false);
});
