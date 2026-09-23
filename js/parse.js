// Turns raw OCR text from the back of a sticker into { code, number }.
//
// OCR on small printed codes regularly confuses look-alike glyphs (O/0, I/1,
// S/5, B/8...). We therefore coerce a token towards letters when it should be
// a team code and towards digits when it should be a sticker number, and only
// accept the result when it is a real code with an in-range number.
(function (root) {
  const Teams = (typeof module !== 'undefined' && module.exports)
    ? require('./teams.js')
    : root.PaniniTeams;

  // Only the confusions OCR really makes on this print; looser mappings
  // (T->1, A->4...) turned random words into sticker codes.
  const TO_LETTER = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B' };
  const TO_DIGIT = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', L: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };

  const asLetters = s => s.replace(/[0-9]/g, c => TO_LETTER[c] || c);
  const asDigits = s => s.replace(/[^0-9]/g, c => TO_DIGIT[c] || c);

  const stripAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Longest aliases first so "SOUTH AFRICA" wins over a shorter overlap.
  const ALIASES = Teams.TEAMS
    .flatMap(t => t.aliases.map(a => ({ key: a.replace(/[^A-Z]/g, ''), code: t.code })))
    .filter(a => a.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length);

  function inRange(code, n) {
    const t = Teams.BY_CODE[code];
    return !!t && Number.isInteger(n) && n >= t.min && n <= t.max;
  }

  function readNumber(tok) {
    if (!tok || tok.length > 2) return null;
    const d = asDigits(tok);
    return /^\d{1,2}$/.test(d) ? parseInt(d, 10) : null;
  }

  // A team code as printed: three capitals (a digit may stand in for a
  // look-alike letter, but at least two must be real capitals).
  function readCode(tok) {
    if (!/^[A-Z0-9]{3}$/.test(tok) || (tok.match(/[A-Z]/g) || []).length < 2) return null;
    const code = asLetters(tok);
    return Teams.BY_CODE[code] ? code : null;
  }

  function parseCardText(text) {
    const clean = stripAccents(String(text || ''));
    const upper = clean.toUpperCase();
    // Case is kept: codes are printed in capitals, and lowercase OCR noise
    // ("Sen", "Ji") must not turn into a code.
    const tokens = clean.split(/[^A-Za-z0-9|]+/).filter(Boolean);
    const candidates = [];
    const push = (code, n, score) => { if (inRange(code, n)) candidates.push({ code, number: n, score }); };

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      // "NZL" "3"  (code and number as separate tokens)
      const code = readCode(tok);
      if (code) {
        const n = readNumber(tokens[i + 1]);
        if (n !== null) push(code, n, tok === code ? 3 : 2);
      }

      // "NZL3", or with pill-edge junk in front: "CNZL3"
      for (const numLen of [1, 2]) {
        if (tok.length < 3 + numLen) continue;
        const n = readNumber(tok.slice(-numLen));
        const pre = tok.slice(0, -numLen);
        const c = readCode(pre.slice(-3));
        if (n === null || !c) continue;
        push(c, n, (pre.slice(-3) === c ? 3 : 2) - (pre.length > 3 ? 1 : 0));
      }
    }

    // Team named in full somewhere on the card?
    const compact = upper.replace(/[^A-Z]/g, '');
    const named = ALIASES.find(a => compact.includes(a.key));
    const teamHint = named ? named.code : null;

    if (candidates.length) {
      for (const c of candidates) if (c.code === teamHint) c.score += 2;
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      return { code: best.code, number: best.number, confident: true, teamHint, candidates };
    }

    // Fall back: team name found, pick the first stand-alone plausible number.
    if (teamHint) {
      const n = tokens.map(t => (/^\d{1,2}$/.test(t) ? parseInt(t, 10) : null))
        .find(v => v !== null && inRange(teamHint, v));
      return { code: teamHint, number: n === undefined ? null : n, confident: false, teamHint, candidates };
    }

    return { code: null, number: null, confident: false, teamHint: null, candidates };
  }

  const api = { parseCardText, inRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaniniParse = api;
})(this);
