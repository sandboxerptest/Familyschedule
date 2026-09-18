/** Sign-in for installs that set a household passcode. */

const form = document.getElementById('form');
const pin = document.getElementById('pin');
const submit = document.getElementById('submit');
const error = document.getElementById('error');

/** Only ever bounce back to a path on this origin. */
function safeNext() {
  const requested = new URLSearchParams(location.search).get('next');
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return '/edit';
  return requested;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  error.classList.remove('is-shown');

  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.value }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      error.textContent = payload.error || 'That did not work — try again';
      error.classList.add('is-shown');
      pin.select();
      return;
    }

    location.replace(safeNext());
  } catch {
    error.textContent = 'Could not reach the calendar — is it still running?';
    error.classList.add('is-shown');
  } finally {
    submit.disabled = false;
  }
});
