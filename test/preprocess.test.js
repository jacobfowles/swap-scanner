// Run with: node test/preprocess.test.js
const assert = require('assert');
const { splitCode, isBar, findCodePill } = require('../js/preprocess.js');

// Draw black rectangles on a white RGBA image.
function image(w, h, rects) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  }
  return { width: w, height: h, data };
}

// "C I V   2": three letters, a wider space, one digit. The C and V are
// hollow boxes (not bars); the I is a solid narrow bar.
const img = image(200, 60, [
  [10, 10, 34, 13], [10, 10, 13, 49], [10, 46, 34, 49],   // C
  [42, 10, 47, 49],                                       // I
  [55, 10, 58, 49], [75, 10, 78, 49], [55, 46, 78, 49],   // V-ish
  [110, 10, 130, 49],                                     // 2 (a block)
]);
const parts = splitCode(img);
assert.ok(parts, 'label splits');
assert.strictEqual(parts.letters.length, 3);
assert.strictEqual(parts.digits.length, 1);
const letterHeight = Math.max(...parts.letters.map(r => r.y1 - r.y0 + 1));
assert.deepStrictEqual(parts.letters.map(r => isBar(r, letterHeight)), [false, true, false]);

// A thin I touching the V: two letter runs get cut back into three.
const touching = splitCode(image(200, 60, [
  [10, 10, 34, 13], [10, 10, 13, 49], [10, 46, 34, 49],   // C
  [42, 10, 45, 49], [46, 30, 50, 32],                     // I, joined to the V by a sliver
  [51, 10, 54, 49], [70, 10, 73, 49], [51, 46, 73, 49],   // V-ish
  [110, 10, 130, 49],                                     // 2
]));
assert.ok(touching);
assert.strictEqual(touching.letters.length, 3);
const th = Math.max(...touching.letters.map(r => r.y1 - r.y0 + 1));
assert.strictEqual(isBar(touching.letters[1], th), true);

// No clear space between letters and number: can't split.
assert.strictEqual(splitCode(image(200, 60, [[10, 10, 30, 49], [40, 10, 60, 49], [70, 10, 90, 49]])), null);

// Sticker pictures for the label finder: grey rectangles on a dark table.
function sticker(w, h, draw) {
  const data = new Uint8ClampedArray(w * h * 4);
  const fill = (x0, y0, x1, y1, v) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
  };
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  fill(0, 0, w - 1, h - 1, 40);                 // dark table
  draw(fill);
  return { width: w, height: h, data };
}

// Portrait sticker: dark label with white code along the top edge.
const portrait = findCodePill(sticker(320, 448, fill => {
  fill(20, 20, 300, 428, 235);                  // card
  fill(40, 200, 280, 260, 70);                  // logo stroke in the middle: not a label
  fill(170, 36, 270, 64, 60);                   // label
  for (const x of [182, 196, 210, 236, 250]) fill(x, 42, x + 5, 58, 240);   // white letters
}));
assert.ok(portrait && !portrait.vertical && !portrait.inverted, 'portrait label found');
assert.ok(portrait.y < 40 && portrait.x > 160, 'it is the label, not the logo stroke');

// Landscape team photo (#13) placed sideways: light label with dark code in
// the dark strip along the right edge.
const sideways = findCodePill(sticker(320, 448, fill => {
  fill(20, 20, 300, 428, 235);                  // card
  fill(230, 150, 290, 400, 70);                 // dark strip
  fill(250, 250, 280, 350, 225);                // light label
  for (const y of [262, 276, 290, 316, 330]) fill(258, y, 272, y + 5, 60);   // dark letters
}));
assert.ok(sideways && sideways.vertical && sideways.inverted, 'sideways inverted label found');
assert.ok(Math.abs(sideways.angle) < 0.05, 'its tilt is measured from the vertical');

console.log('all preprocess tests passed');
