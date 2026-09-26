// The duplicates catalog: sticker id ("MEX 12") -> how many spares we have.
// Pure data + CSV helpers; persistence lives in app.js.
(function (root) {
  const Teams = (typeof module !== 'undefined' && module.exports)
    ? require('./teams.js')
    : root.PaniniTeams;
  const Parse = (typeof module !== 'undefined' && module.exports)
    ? require('./parse.js')
    : root.PaniniParse;

  const CSV_HEADER = ['sticker', 'code', 'number', 'team', 'group', 'quantity'];

  const stickerId = (code, number) => `${code} ${number}`;

  function splitId(id) {
    const [code, n] = id.split(' ');
    return { code, number: parseInt(n, 10) };
  }

  function sortedEntries(items) {
    return Object.entries(items)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => ({ id, qty, ...splitId(id) }))
      .sort((a, b) => {
        const ta = Teams.BY_CODE[a.code], tb = Teams.BY_CODE[b.code];
        const oa = ta ? ta.order : 999, ob = tb ? tb.order : 999;
        return oa - ob || a.code.localeCompare(b.code) || a.number - b.number;
      });
  }

  function csvCell(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(items) {
    const rows = [CSV_HEADER];
    for (const e of sortedEntries(items)) {
      const t = Teams.BY_CODE[e.code] || { name: '', group: '' };
      rows.push([e.id, e.code, e.number, t.name, t.group, e.qty]);
    }
    return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
  }

  function parseCSVLine(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // Accepts our own export, or any CSV with a "sticker" column ("MEX 12") or
  // "code" + "number" columns, and an optional "quantity"/"qty" column.
  // Returns { items, skipped }.
  function fromCSV(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const items = {};
    let skipped = 0;
    if (!lines.length) return { items, skipped };

    const head = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const hasHeader = head.some(h => ['sticker', 'code', 'number', 'quantity', 'qty'].includes(h));
    const col = name => head.indexOf(name);
    const iSticker = hasHeader ? col('sticker') : 0;
    const iCode = hasHeader ? col('code') : -1;
    const iNum = hasHeader ? col('number') : -1;
    const iQty = hasHeader ? Math.max(col('quantity'), col('qty')) : 1;

    for (const line of lines.slice(hasHeader ? 1 : 0)) {
      const cells = parseCSVLine(line);
      let code = null, number = null;
      if (iCode >= 0 && iNum >= 0) {
        code = (cells[iCode] || '').toUpperCase();
        number = parseInt(cells[iNum], 10);
      } else if (iSticker >= 0) {
        const m = (cells[iSticker] || '').toUpperCase().match(/^([A-Z]{3})\s*-?\s*(\d{1,2})$/);
        if (m) { code = m[1]; number = parseInt(m[2], 10); }
      }
      const qty = iQty >= 0 && cells[iQty] !== undefined && cells[iQty] !== '' ? parseInt(cells[iQty], 10) : 1;
      if (!code || !Parse.inRange(code, number) || !(qty > 0)) { skipped++; continue; }
      const id = stickerId(code, number);
      items[id] = (items[id] || 0) + qty;
    }
    return { items, skipped };
  }

  // Compact text for pasting into a chat: "MEX 3, 7 (x2), 12".
  function toTradeText(items, name) {
    const byTeam = new Map();
    for (const e of sortedEntries(items)) {
      if (!byTeam.has(e.code)) byTeam.set(e.code, []);
      byTeam.get(e.code).push(e.qty > 1 ? `${e.number} (x${e.qty})` : String(e.number));
    }
    const lines = [...byTeam].map(([code, nums]) => `${code} ${nums.join(', ')}`);
    const total = sortedEntries(items).reduce((s, e) => s + e.qty, 0);
    return `Panini World Cup 2026 swaps${name ? ' — ' + name : ''} (${total}):\n` + lines.join('\n');
  }

  // Every sticker in the album that this catalog has none of, in album order.
  function missingEntries(items) {
    const out = [];
    for (const t of Teams.TEAMS) {
      for (let n = t.min; n <= t.max; n++) {
        const id = stickerId(t.code, n);
        if (!(items[id] > 0)) out.push({ id, code: t.code, number: n });
      }
    }
    return out;
  }

  const ALBUM_SIZE = Teams.TEAMS.reduce((sum, t) => sum + t.max - t.min + 1, 0);

  const MISSING_HEADER = ['sticker', 'code', 'number', 'team', 'group'];

  function toMissingCSV(items) {
    const rows = [MISSING_HEADER];
    for (const e of missingEntries(items)) {
      const t = Teams.BY_CODE[e.code];
      rows.push([e.id, e.code, e.number, t.name, t.group]);
    }
    return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
  }

  // "Missing (12): MEX 1, 3 / KOR 13 ..." for pasting into a chat.
  function toMissingText(items, name) {
    const byTeam = new Map();
    const missing = missingEntries(items);
    for (const e of missing) {
      if (!byTeam.has(e.code)) byTeam.set(e.code, []);
      byTeam.get(e.code).push(e.number);
    }
    const lines = [...byTeam].map(([code, nums]) => `${code} ${nums.join(', ')}`);
    return `Panini World Cup 2026 — missing${name ? ' from ' + name : ''} (${missing.length}):\n` + lines.join('\n');
  }

  const api = { stickerId, splitId, sortedEntries, toCSV, fromCSV, toTradeText, CSV_HEADER, missingEntries, toMissingCSV, toMissingText, ALBUM_SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaniniCatalog = api;
})(this);
