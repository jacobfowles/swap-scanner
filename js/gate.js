// Password gate shown before the app on first visit. Runs before the app's
// scripts; if a password is configured and this browser hasn't unlocked with
// it yet, the page shows only the gate until the right password is entered.
(function () {
  const UNLOCK_KEY = 'panini-wc26-unlocked';
  const hash = (window.SWAP_SCANNER_CONFIG || {}).passwordHash || '';

  async function sha256(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const hashPassword = password => sha256('swap-scanner:' + password);
  window.swapScannerHash = hashPassword;   // for setting a new password (see config.js)

  let unlocked = null;
  try { unlocked = localStorage.getItem(UNLOCK_KEY); } catch (e) {}
  if (!hash || unlocked === hash) return;

  document.body.classList.add('locked');
  const gate = document.getElementById('gate');
  const input = document.getElementById('gate-password');
  const error = document.getElementById('gate-error');
  gate.hidden = false;
  input.focus();

  document.getElementById('gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    error.textContent = '';
    let ok = false;
    try { ok = (await hashPassword(input.value)) === hash; } catch (err) {
      error.textContent = 'This page needs to be opened over https.';
      return;
    }
    if (!ok) {
      error.textContent = 'Wrong password — try again.';
      input.select();
      return;
    }
    try { localStorage.setItem(UNLOCK_KEY, hash); } catch (err) {}
    gate.hidden = true;
    document.body.classList.remove('locked');
  });
})();
