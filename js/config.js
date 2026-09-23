// Settings for this copy of the app.
//
// passwordHash: the app asks for a password on first visit (remembered on
// that phone afterwards). Only a SHA-256 hash is stored, never the password.
// To change it, open the app, and in the browser console run
//   await swapScannerHash('the new password')
// then paste the result here. Leave empty for no password.
//
// This is a lock on the door, not a safe: the check runs in the browser and
// the code is public, so it keeps casual visitors out, nothing more.
window.SWAP_SCANNER_CONFIG = {
  passwordHash: '268353017c0dc50b3489c7d89be452a4b4d8e843220ac8690f9c3984760a7fc8',
};
