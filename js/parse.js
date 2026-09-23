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

  const TO_LETTER = { '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '8': 'B' };
  const TO_DIGIT = { O: '0', D: '0', Q: '0', U: '0', I: '1', L: '1', T: '1', J: '1', Z: '2', S: '5', B: '8', G: '6', A: '4' };

  const asLetters = s => s.replace(/[0-9]/g, c => TO_LETTER[c] || c);
  const asDigits = s => s.replace(/[A-Z]/g, c => TO_DIGIT[c] || c);

  const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

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

  function parseCardText(text) {
    const upper = stripAccents(String(text || '')).toUpperCase();
    const tokens = upper.split(/[^A-Z0-9]+/).filter(Boolean);
    const candidates = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      // "MEX" "12"  (code and number as separate tokens)
      if (tok.length === 3) {
        const code = asLetters(tok);
        if (Teams.BY_CODE[code]) {
          const n = readNumber(tokens[i + 1]);
          if (n !== null && inRange(code, n)) {
            candidates.push({ code, number: n, score: tok === code ? 3 : 2 });
          }
        }
      }

      // "MEX12"  (glued together)
      if (tok.length === 4 || tok.length === 5) {
        const code = asLetters(tok.slice(0, 3));
        const n = readNumber(tok.slice(3));
        if (Teams.BY_CODE[code] && n !== null && inRange(code, n)) {
          candidates.push({ code, number: n, score: tok.slice(0, 3) === code ? 3 : 2 });
        }
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
