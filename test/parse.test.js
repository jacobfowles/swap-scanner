// Run with: node panini/test/parse.test.js
const assert = require('assert');
const { parseCardText } = require('../js/parse.js');
const Catalog = require('../js/catalog.js');

const cases = [
  ['MEX 12', 'MEX', 12],
  ['mex12', 'MEX', 12],
  ['ARG 1O', 'ARG', 10],          // O read instead of 0
  ['8RA 7', 'BRA', 7],            // 8 read instead of B
  ['FWC 00', 'FWC', 0],
  ['FWC 19', 'FWC', 19],
  ['CUW-5', 'CUW', 5],
  ['© 2026 Panini S.p.A. www.panini.com\nKOR 13\nKorea Republic', 'KOR', 13],
  ['PANINI FIFA WORLD CUP 2026\nUSA 20', 'USA', 20],
  ['Brazil\nno 4 BRA 4', 'BRA', 4],
];
for (const [text, code, number] of cases) {
  const r = parseCardText(text);
  assert.strictEqual(r.code, code, `${JSON.stringify(text)} -> code ${r.code}`);
  assert.strictEqual(r.number, number, `${JSON.stringify(text)} -> number ${r.number}`);
  assert.ok(r.confident, `${JSON.stringify(text)} should be confident`);
}

// Out of range / non-codes are rejected.
assert.strictEqual(parseCardText('MEX 21').code, null);
assert.strictEqual(parseCardText('FWC 20').code, null);
assert.strictEqual(parseCardText('THE 12').code, null);
assert.strictEqual(parseCardText('').code, null);

// Team name only -> not confident, team suggested.
const hint = parseCardText('ARGENTINA\n7');
assert.strictEqual(hint.code, 'ARG');
assert.strictEqual(hint.number, 7);
assert.strictEqual(hint.confident, false);

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

console.log('all parse/catalog tests passed');
