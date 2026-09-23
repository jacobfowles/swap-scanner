// Run with: node test/preprocess.test.js
const assert = require('assert');
const { splitCode, isBar } = require('../js/preprocess.js');

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

// No clear space between letters and number: can't split.
assert.strictEqual(splitCode(image(200, 60, [[10, 10, 30, 49], [40, 10, 60, 49], [70, 10, 90, 49]])), null);

console.log('all preprocess tests passed');
