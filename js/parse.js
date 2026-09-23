// Turns the OCR'd text of a sticker's code label into { code, number }.
//
// The label is always exactly three capital letters followed by a one- or
// two-digit number ("NZL 3", "ESP 19"). Anything else is rejected. Because
// the positions are fixed, a digit read where a letter must be (0 for O, 8
// for B...) or a letter where a digit must be (O for 0, I for 1...) is
// corrected by position. The result must be a real team code with a number
// in that team's range.
(function (root) {
  const Teams = (typeof module !== 'undefined' && module.exports)
    ? require('./teams.js')
    : root.PaniniTeams;

  const TO_LETTER = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B' };
  const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };

  function inRange(code, n) {
    const t = Teams.BY_CODE[code];
    return !!t && Number.isInteger(n) && n >= t.min && n <= t.max;
  }

  const NONE = { code: null, number: null, confident: false };

  function parseCodeLine(text) {
    const m = String(text || '').trim().match(/^([A-Z0-9]{3}) ?([A-Z0-9]{1,2})$/);
    if (!m) return NONE;
    const code = m[1].replace(/[0-9]/g, c => TO_LETTER[c] || c);
    const digits = m[2].replace(/[A-Z]/g, c => TO_DIGIT[c] || c);
    if (!/^[A-Z]{3}$/.test(code) || !/^\d{1,2}$/.test(digits)) return NONE;
    const number = parseInt(digits, 10);
    if (!inRange(code, number)) return NONE;
    return { code, number, confident: true };
  }

  // Letters that can appear at each position of a code (from the 49 codes).
  const POSITION_LETTERS = [0, 1, 2].map(i =>
    [...new Set(Teams.TEAMS.map(t => t.code[i]))].sort().join(''));

  // Pick the real code that best matches per-letter OCR guesses. `scores` is
  // three maps of letter -> confidence (0-100), one per position, holding
  // every letter the OCR considered. A code is only a candidate if each of
  // its letters was considered at its position; the highest total wins.
  function bestCode(scores) {
    let best = null;
    for (const { code } of Teams.TEAMS) {
      let total = 0;
      for (let i = 0; i < 3 && total >= 0; i++) {
        const c = scores[i][code[i]];
        total = c === undefined ? -1 : total + c;
      }
      if (total >= 0 && (!best || total > best.total)) best = { code, total };
    }
    return best ? best.code : null;
  }

  const api = { parseCodeLine, inRange, bestCode, POSITION_LETTERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaniniParse = api;
})(this);
