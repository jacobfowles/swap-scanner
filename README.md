# Swap Scanner — Panini FIFA World Cup 2026

A phone web app for cataloguing your duplicate Panini World Cup 2026 stickers.
Point the camera at the **back** of a sticker, the app reads the code
(`MEX 12`, `FWC 00`, …), and adds it to your swaps list. Export the list as a
CSV, or copy a short text version to paste into a group chat.

Everything runs in the browser. Text recognition uses
[Tesseract.js](https://github.com/naptha/tesseract.js), loaded from jsDelivr
the first time (a few MB); nothing is uploaded anywhere. The catalog is saved
in the browser on that phone.

## Getting it on your phone

The camera only works on an `https://` page (or `localhost`). The easiest
option is GitHub Pages: repo **Settings → Pages → Deploy from a branch**, pick
the branch and `/ (root)`, then open

    https://<your-user>.github.io/<repo>/panini/

On the phone, use *Add to Home Screen* so it opens like an app.

For a quick test on a computer: `python3 -m http.server 8000` in the repo root
and open <http://localhost:8000/panini/>.

## Using it

- **Scan** — tap *Start camera*, fit the back of the sticker in the box
  (straight, not tilted), tap *Scan*. Check the team and number, set *How many* if you have several of that
  one, and tap *Add*. Good light helps a lot; the 🔦 button turns on the
  flashlight on phones that support it.
- **Scan area** — for a scanner stand: tap *Scan area*, drag a box on the
  camera view around the code label (or the whole sticker), and *Save area*.
  It's remembered on that phone; *Use default* goes back to the sticker-shaped
  guide. A box with a little margin around the label works best.
- **Auto-scan** — reads continuously, no button tapping. With *Add without
  asking* also ticked, a sticker is added once it has been read confidently
  on two frames in a row. The same code won't be added again until the card leaves the
  box, so for a stack of identical spares just swap cards one by one.
  You know when to swap without watching the status line:
  - **Added:** a rising two-note beep and a big green **✓ ESP 16** banner on
    the camera view. It stays until you take that card out.
  - **Banner gone:** the card has left the box and the app is ready for the
    next one.
  - **Crooked card:** a low buzz (once) and an orange **Straighten the card**
    banner.
  Untick *Sound* to go silent (Android phones also vibrate).
- **Type it in** — for anything the camera struggles with.
- **Undo** — every add shows a toast with *Undo* for a few seconds.
- **Catalog** — spares grouped by team in album order, with +/− buttons and a
  filter.
- **Share / Download CSV** — columns `sticker,code,number,team,group,quantity`.
- **Copy swap list** — e.g. `MEX 2 (x3), 12` per team, ready to paste.
- **Import CSV** — merge another phone's export into yours (or replace your
  list). It also accepts any CSV with a `sticker` column (`MEX 12`) or `code`
  and `number` columns, plus an optional `quantity`.

## How the reading works

The code is printed in white inside a dark rounded label at the top right of
every sticker back, and it is always three capital letters followed by a one-
or two-digit number (`NZL 3`, `ESP 19`). The app finds that label, turns it
into clean black-on-white text and reads it as one line.

- A read only counts if it is exactly that format, a real team code and a
  number that exists for that team. Where a letter must be, a misread `0` is
  taken as `O` (and `O` as `0` where a digit must be), and so on.
- Each scan reads the label at a few sizes and is only *sure* when two reads
  agree; otherwise it asks you to check. Auto-add only uses sure reads.
- A card tilted more than 4° is rejected with a prompt to straighten it and
  scan again — nothing is guessed. (Draw the scan area with a little margin
  around the label so the tilt can be measured.)
- If the label isn't found or can't be read, you're asked to rescan.

## The album

48 teams × 20 stickers (1 = team logo, 13 = team photo, the rest players) plus
20 `FWC` specials (`FWC 00`–`FWC 19`) = 980. Team codes live in
[`js/teams.js`](js/teams.js) if anything needs correcting.

## Tests

    node panini/test/parse.test.js

covers the OCR-text parser (including common misreads like `O`↔`0`, `8`↔`B`,
and noise seen on real sticker backs) and CSV import/export.
