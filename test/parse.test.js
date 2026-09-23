// Run with: node test/parse.test.js
const assert = require('assert');
const { parseCodeLine, bestCode, POSITION_LETTERS } = require('../js/parse.js');
const Catalog = require('../js/catalog.js');

// Label text as read off real sticker backs, plus position-corrected misreads.
const good = [
  ['NZL 3', 'NZL', 3],
  ['ESP 19', 'ESP', 19],
  ['JOR 11', 'JOR', 11],
  ['MEX12', 'MEX', 12],            // space missed
  [' KOR 13 \n', 'KOR', 13],        // surrounding whitespace
  ['ARG 1O', 'ARG', 10],           // O where a digit must be
  ['8RA 7', 'BRA', 7],             // 8 where a letter must be
  ['FWC 00', 'FWC', 0],
  ['FWC 19', 'FWC', 19],
  ['CUW 20', 'CUW', 20],
];
for (const [text, code, number] of good) {
  const r = parseCodeLine(text);
  assert.deepStrictEqual([r.code, r.number, r.confident], [code, number, true], JSON.stringify(text));
}

// Anything that isn't exactly 3 capitals + 1-2 digits, a real code and an
// in-range number is rejected.
const bad = [
  '', 'NZL', 'NZL 123', 'NL 3', 'CNZL3', '(NZL 3)', 'NZL 3 +', 'nzl 3', 'Nzl 3',
  'NZL  3', 'NZL-3', 'MEX 21', 'MEX 0', 'FWC 20', 'ABC 5', 'SUI', 'FIFA WORLD CUP 2026',
];
for (const text of bad) assert.strictEqual(parseCodeLine(text).confident, false, JSON.stringify(text));

// Code-constrained letter decoding (real CIV 15 photo: the C glyph was read
// as "GC" with G 92 / C 98; the I is a detected bar).
assert.strictEqual(bestCode([{ G: 92, C: 98 }, { I: 100 }, { V: 92 }]), 'CIV');
assert.strictEqual(bestCode([{ G: 92, C: 79 }, { I: 100 }, { V: 92 }]), 'CIV');   // GIV isn't a code
assert.strictEqual(bestCode([{ G: 92 }, { I: 100 }, { V: 92 }]), null);           // C never considered
assert.strictEqual(bestCode([{ E: 90 }, { S: 95 }, { P: 97 }]), 'ESP');
assert.strictEqual(bestCode([{ N: 90 }, { Z: 20, L: 60 }, { L: 90 }]), 'NZL');
// Letters possible at each position come from the real codes only.
assert.ok(!POSITION_LETTERS[0].includes('V') && POSITION_LETTERS[2].includes('V'));

// CSV round trip, album order.
const items = { 'ARG 7': 2, 'MEX 12': 1, 'FWC 3': 1, 'MEX 2': 3 };
const csv = Catalog.toCSV(items);
assert.strictEqual(csv.split('\n')[0], 'sticker,code,number,team,group,quantity');
assert.deepStrictEqual(csv.trim().split('\n').slice(1).map(l => l.split(',')[0]), ['FWC 3', 'MEX 2', 'MEX 12', 'ARG 7']);
assert.deepStrictEqual(Catalog.fromCSV(csv).items, items);

// Loose CSV: sticker column only, junk row skipped.
const loose = Catalog.fromCSV('Sticker\nmex 4\nBRA-9\nnonsense\n');
assert.deepStrictEqual(loose.items, { 'MEX 4': 1, 'BRA 9': 1 });
assert.strictEqual(loose.skipped, 1);

assert.strictEqual(Catalog.toTradeText(items),
  'Panini World Cup 2026 swaps (7):\nFWC 3\nMEX 2 (x3), 12\nARG 7 (x2)');

assert.ok(Catalog.toTradeText(items, 'Sam’s swaps').startsWith('Panini World Cup 2026 swaps — Sam’s swaps (7):'));

console.log('all parse/catalog tests passed');
