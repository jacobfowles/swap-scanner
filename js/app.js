(function () {
  const { TEAMS, BY_CODE } = window.PaniniTeams;
  const { parseCodeLine, inRange, bestCode, POSITION_LETTERS } = window.PaniniParse;
  const Catalog = window.PaniniCatalog;
  const { prepareForOcr, findCodePill, clearBorder, isolateText, splitCode, isBar } = window.PaniniPreprocess;

  const STORE_KEY = 'panini-wc26-catalogs-v1';
  const OLD_STORAGE_KEY = 'panini-wc26-swaps-v1';   // single catalog, before named catalogs
  const AREA_KEY = 'panini-wc26-area-v1';
  const SOUND_KEY = 'panini-wc26-sound-v1';
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- state --
  const store = loadStore();   // { current, catalogs: { id: { name, items, updated } } }
  const state = {
    items: store.catalogs[store.current].items,   // the current catalog's stickers
    area: loadArea(),   // user-drawn scan box, fractions of the camera view
    stream: null,
    torchOn: false,
    scanning: false,
    auto: false,
    autoAdd: false,
    lastRead: null,     // id read on the previous frame (auto mode)
    lockedId: null,     // id just auto-added; wait for the card to change
    misses: 0,
    warned: false,      // crooked-card warning already given for this card
    disturbed: false,   // movement seen since the last add: a card is being stacked
    paused: false,      // auto-scan stopped after a while with no card in view
    lastSeenAt: 0,      // when auto-scan last saw a card (or was (re)started)
    loopId: 0,          // only the newest auto-scan loop keeps running
    recent: [],
    undoStack: [],      // adds in this catalog that can be undone, newest last
  };

  // All catalogs live in one localStorage entry. A catalog from before named
  // catalogs existed is carried over as "My swaps".
  function loadStore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (data && data.catalogs && data.catalogs[data.current]) return data;
    let items = {};
    try {
      const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY));
      if (old && old.items) items = old.items;
    } catch (e) {}
    const id = newCatalogId();
    return { current: id, catalogs: { [id]: { name: 'My swaps', items, updated: new Date().toISOString() } } };
  }

  function newCatalogId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  const currentCatalog = () => store.catalogs[store.current];

  function loadArea() {
    try {
      const a = JSON.parse(localStorage.getItem(AREA_KEY));
      return a && a.w > 0.02 && a.h > 0.02 ? a : null;
    } catch (e) {
      return null;
    }
  }

  function save() {
    const cat = currentCatalog();
    cat.items = state.items;
    cat.updated = new Date().toISOString();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      setStatus('Could not save to this browser — export your CSV to be safe.');
    }
  }

  function addSticker(code, number, qty) {
    const id = Catalog.stickerId(code, number);
    const next = Math.max(0, (state.items[id] || 0) + qty);
    if (next) state.items[id] = next; else delete state.items[id];
    save();
    render();
    return id;
  }

  // ------------------------------------------------------------------ tabs --
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + btn.dataset.tab));
    });
  });

  // ---------------------------------------------------------------- camera --
  const video = $('video');

  async function startCamera() {
    $('camera-error').textContent = '';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('camera-error').textContent = 'Camera access needs a secure (https) page. Open the app from its https:// link.';
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      $('camera-error').textContent = e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
        : 'Could not open the camera: ' + e.message;
      return;
    }
    video.srcObject = state.stream;
    await video.play().catch(() => {});
    $('camera-off').hidden = true;
    $('scan-btn').disabled = false;

    const track = state.stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    $('torch-btn').hidden = !caps.torch;

    setStatus('Loading the text reader…');
    getWorker().then(
      () => setStatus('Ready. Fit the back of a sticker in the box and tap Scan.'),
      () => setStatus('The text reader failed to load (offline?). You can still type stickers in.')
    );
  }

  async function toggleTorch() {
    const track = state.stream && state.stream.getVideoTracks()[0];
    if (!track) return;
    state.torchOn = !state.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
    } catch (e) {
      state.torchOn = false;
    }
    $('torch-btn').classList.toggle('on', state.torchOn);
  }

  // ------------------------------------------------------------------- OCR --
  let workerPromise = null;
  function getWorker() {
    if (!workerPromise) {
      if (!window.Tesseract) return Promise.reject(new Error('Tesseract not loaded'));
      workerPromise = (async () => {
        return Tesseract.createWorker('eng');
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // The guide box, in video-frame pixels (the video is shown object-fit: cover).
  function guideRect() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const box = video.getBoundingClientRect();
    const g = $('guide').getBoundingClientRect();
    const scale = Math.max(box.width / vw, box.height / vh);
    const ox = (box.width - vw * scale) / 2, oy = (box.height - vh * scale) / 2;
    const x = Math.max(0, (g.left - box.left - ox) / scale);
    const y = Math.max(0, (g.top - box.top - oy) / scale);
    return { x, y, w: Math.min(vw - x, g.width / scale), h: Math.min(vh - y, g.height / scale) };
  }

  // Draw a rectangle of the current frame onto the work canvas, `targetW`
  // pixels wide once turned by `rot` degrees (0, 90 or -90: a sideways label
  // is turned upright); return its pixels.
  function grab(rect, targetW, rot = 0) {
    const turned = rot !== 0;
    const k = targetW / (turned ? rect.h : rect.w);
    const canvas = $('work');
    canvas.width = Math.max(1, Math.round((turned ? rect.h : rect.w) * k));
    canvas.height = Math.max(1, Math.round((turned ? rect.w : rect.h) * k));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (turned) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rot * Math.PI / 180);
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, -rect.w * k / 2, -rect.h * k / 2, rect.w * k, rect.h * k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    }
    return { canvas, ctx, img: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }

  // The label as dark text on white, `height` px tall (Tesseract reads text
  // best around 40-60px high). Returns an unpadded canvas of its own.
  function labelCanvas(rect, height, rot = 0, inverted = false) {
    const long = rot ? rect.h : rect.w, short = rot ? rect.w : rect.h;
    const { canvas, ctx, img } = grab(rect, height * long / short, rot);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    out.getContext('2d', { willReadFrequently: true })
      .putImageData(isolateText(clearBorder(prepareForOcr(img, inverted ? 'plain' : 'invert'))), 0, 0);
    return out;
  }

  // Copy glyph columns `runs` (rows top..bottom) of `src` onto a new white
  // canvas with a margin, at least `minGap` px apart. Spreading the letters
  // stops a narrow one (the I in CIV) being swallowed by its neighbour.
  function composeRuns(src, runs, top, bottom, minGap) {
    const pad = 20, h = bottom - top + 1;
    const gaps = runs.slice(1).map((r, i) => Math.max(minGap, r.x0 - runs[i].x1 - 1));
    const width = runs.reduce((sum, r) => sum + r.x1 - r.x0 + 1, 0) + gaps.reduce((a, g) => a + g, 0);
    const out = document.createElement('canvas');
    out.width = width + 2 * pad;
    out.height = h + 2 * pad;
    const o = out.getContext('2d');
    o.fillStyle = '#fff';
    o.fillRect(0, 0, out.width, out.height);
    let x = pad;
    runs.forEach((r, i) => {
      const rw = r.x1 - r.x0 + 1;
      o.drawImage(src, r.x0, top, rw, h, x, pad, rw, h);
      x += rw + (gaps[i] || 0);
    });
    return out;
  }

  // Cards tilted more than this are rejected rather than straightened.
  const MAX_SKEW_DEG = 4;

  // The code is printed in white inside a dark pill at the top right of the
  // sticker back. Find it in the scan area: returns { rect, skew } (skew in
  // degrees) or null.
  function findPill(guide, opts) {
    const small = grab(guide, 320);
    const p = findCodePill(small.img, opts);
    if (!p) return null;
    const k = guide.w / small.canvas.width;
    const pad = p.thick * 0.25;
    const x = Math.max(0, guide.x + (p.x - pad) * k), y = Math.max(0, guide.y + (p.y - pad) * k);
    const rect = {
      x, y,
      w: Math.min(video.videoWidth - x, (p.w + 2 * pad) * k),
      h: Math.min(video.videoHeight - y, (p.h + 2 * pad) * k),
    };
    return { rect, skew: p.angle * 180 / Math.PI, vertical: p.vertical, inverted: p.inverted };
  }

  const LINE = { tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' };
  const CODE_LETTERS = [...new Set(POSITION_LETTERS.join(''))].sort().join('');
  const LETTERS = { tessedit_pageseg_mode: '8', tessedit_char_whitelist: CODE_LETTERS };
  // One letter glyph at code position i: only letters that occur there.
  const letterParams = i => ({ tessedit_pageseg_mode: '10', tessedit_char_whitelist: POSITION_LETTERS[i] });
  const DIGITS = { tessedit_pageseg_mode: '8', tessedit_char_whitelist: '0123456789' };

  async function ocr(worker, canvas, params, tag) {
    return (await ocrSymbols(worker, canvas, params, tag)).text;
  }

  // OCR returning the text plus, per recognised character, every letter the
  // engine considered with its confidence: [{ A: 92, ... }, ...].
  async function ocrSymbols(worker, canvas, params, tag) {
    await worker.setParameters(params);
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const symbols = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
      for (const sym of w.symbols) {
        const m = {};
        for (const c of [{ text: sym.text, confidence: sym.confidence }, ...sym.choices]) {
          if (c.text && c.confidence > (m[c.text] ?? -1)) m[c.text] = c.confidence;
        }
        symbols.push(m);
      }
    }
    if (window.__scanDebug) window.__scanDebug.push({ mode: tag, t: Math.round(performance.now()), text: data.text + ' ' + JSON.stringify(symbols), png: canvas.toDataURL() });
    return { text: data.text.trim(), symbols };
  }

  // Read one rendering of the label. Preferred: split it at the space and
  // read the letters and the number (0-9 only) separately. Each letter glyph
  // is read on its own, limited to the letters that occur at that position
  // in a real code, and a plain bar is taken as I (OCR drops it: CIV, BIH,
  // SUI...). The code is then the real code that best matches every letter
  // the OCR considered — "G or C", "I", "V" gives CIV. The digit count must
  // match the digit glyphs. If the label can't be split, read it as a line.
  async function readLabel(worker, rect, height, rot = 0, inverted = false) {
    const label = labelCanvas(rect, height, rot, inverted);
    const parts = splitCode(label.getContext('2d').getImageData(0, 0, label.width, label.height));
    if (parts) {
      const { top, bottom } = parts;
      const gap = Math.round((bottom - top + 1) * 0.3);
      let scores = null;
      if (parts.letters.length === 3) {
        const letterHeight = Math.max(...parts.letters.map(r => r.y1 - r.y0 + 1));
        scores = [];
        for (const [i, run] of parts.letters.entries()) {
          if (isBar(run, letterHeight)) { scores.push({ I: 100 }); continue; }
          const { symbols } = await ocrSymbols(worker, composeRuns(label, [run], top, bottom, gap), letterParams(i), 'letter' + height);
          // A glyph read as two characters ("GC"): pool what was considered.
          const pooled = {};
          for (const m of symbols) for (const [ch, c] of Object.entries(m)) pooled[ch] = Math.max(pooled[ch] ?? -1, c);
          scores.push(pooled);
        }
      } else {
        // Touching letters: read the group as a word; usable if it gives 3.
        const { symbols } = await ocrSymbols(worker, composeRuns(label, parts.letters, top, bottom, gap), LETTERS, 'letters' + height);
        if (symbols.length === 3) scores = symbols;
      }
      const code = scores && bestCode(scores);
      if (code) {
        const digits = (await ocr(worker, composeRuns(label, parts.digits, top, bottom, gap), DIGITS, 'digits' + height)).replace(/\s/g, '');
        // Two separate digit glyphs must give two digits (and one, one).
        const digitsOk = parts.digits.length > 2 || parts.digits.length === 1 || digits.length === parts.digits.length;
        const r = parseCodeLine(`${code} ${digits}`);
        if (r.confident && digitsOk) return r;
      }
    }
    const pad = 20;
    const line = document.createElement('canvas');
    line.width = label.width + 2 * pad;
    line.height = label.height + 2 * pad;
    const o = line.getContext('2d');
    o.fillStyle = '#fff';
    o.fillRect(0, 0, line.width, line.height);
    o.drawImage(label, pad, pad);
    return parseCodeLine(await ocr(worker, line, LINE, 'line' + height));
  }

  // Reads the label at a few sizes and stops once two reads agree. Returns
  // { code, number, confident, sure, reason }: `sure` means two reads agreed
  // (a lone read is offered for checking, auto-add ignores it); when nothing
  // was read, `reason` is 'no-label', 'skewed' (with `skew`) or 'unreadable'.
  async function scanOnce() {
    const worker = await getWorker();
    const none = { code: null, number: null, confident: false, sure: false };
    const guide = guideRect();
    if (!guide) return { ...none, reason: 'no-label' };

    const custom = !!state.area;
    const pill = findPill(guide, custom ? { maxWidth: 1 } : undefined);
    if (window.__scanDebug && pill) window.__scanDebug.push({ mode: 'skew', text: pill.skew.toFixed(2) });
    if (pill && Math.abs(pill.skew) > MAX_SKEW_DEG) return { ...none, reason: 'skewed', skew: pill.skew, labelSeen: true };

    const passes = [];
    if (pill) for (const h of [120, 150, 100]) passes.push({ rect: pill.rect, h });
    // A box drawn tight around (or inside) the label: read the whole box too.
    if (custom) passes.push({ rect: guide, h: 120 });
    if (!passes.length) return { ...none, reason: 'no-label' };
    // A vertical label (landscape sticker placed sideways) is turned upright;
    // the card may face either way, so try both turns until one reads.
    let turns = pill && pill.vertical ? [-90, 90] : [0];

    const votes = new Map();
    let first = null;
    for (const pass of passes) {
      let r = null;
      for (const rot of pass.rect === guide ? [0] : turns) {
        r = await readLabel(worker, pass.rect, pass.h, rot, pass.rect !== guide && !!pill.inverted);
        if (r.confident) { if (turns.length > 1) turns = [rot]; break; }
      }
      if (!r.confident) continue;
      const id = Catalog.stickerId(r.code, r.number);
      votes.set(id, (votes.get(id) || 0) + 1);
      if (!first) first = r;
      if (votes.get(id) >= 2) return { ...r, sure: true };
    }
    if (!first) return { ...none, reason: pill ? 'unreadable' : 'no-label', labelSeen: !!pill };
    return { ...first, sure: false };
  }

  function rescanMessage(r) {
    if (r.reason === 'skewed') {
      return `The card is crooked (about ${Math.round(Math.abs(r.skew))}°). Straighten it and scan again.`;
    }
    if (r.reason === 'no-label') return "Couldn't find the code label. Line the sticker up in the box and scan again.";
    return "Couldn't read the code. Check the light (no glare), hold steady and scan again.";
  }

  function setGuide(cls) {
    $('guide').classList.remove('busy', 'hit');
    if (cls) $('guide').classList.add(cls);
  }

  async function manualScan() {
    if (state.scanning) return;
    state.scanning = true;
    $('scan-btn').disabled = true;
    setGuide('busy');
    setStatus('Reading…');
    try {
      const r = await scanOnce();
      if (r.confident) {
        setGuide('hit');
        setStatus(r.sure ? `Read ${r.code} ${r.number}.` : `Read ${r.code} ${r.number} — please check it.`);
        openSheet(r);
      } else {
        setGuide(null);
        setStatus(rescanMessage(r));
      }
    } catch (e) {
      setGuide(null);
      setStatus('The text reader is not available. You can type stickers in.');
    } finally {
      state.scanning = false;
      $('scan-btn').disabled = !state.stream;
    }
  }

  // Auto mode keeps reading frames. With "add without asking" on, a sticker
  // is added once the same code is read (surely) on two frames in a row.
  // After that the same code is ignored until either the box is empty for
  // two frames (card taken out) or movement is seen in the box (the next card
  // being stacked on top) — so a pile of identical duplicates still counts
  // one per card.
  async function autoLoop() {
    const loop = ++state.loopId;
    state.paused = false;
    state.lastSeenAt = performance.now();
    hidePaused();
    while (state.auto && state.stream && loop === state.loopId) {
      const still = performance.now() - motion.lastAt > MOTION_SETTLE_MS;
      const idle = $('sheet').hidden && $('area-editor').hidden;
      // Time with the confirm sheet or area editor open doesn't count.
      if (!idle) state.lastSeenAt = performance.now();
      if (still && idle && !state.scanning) {
        state.scanning = true;
        setGuide('busy');
        const startedAt = performance.now();
        let r;
        try { r = await scanOnce(); } catch (e) { r = null; }
        state.scanning = false;
        if (!state.auto || loop !== state.loopId) break;
        // Any label in view — read, crooked or not yet readable — is a card.
        if (r && (r.confident || r.labelSeen)) state.lastSeenAt = performance.now();
        // Something moved while reading: that frame may be the old card.
        if (motion.lastAt <= startedAt) handleAutoRead(r);
        if (performance.now() - state.lastSeenAt > NO_CARD_TIMEOUT_MS) { pauseAuto(); break; }
      }
      await new Promise(res => setTimeout(res, still ? 250 : 80));
    }
    setGuide(null);
  }

  // After a few seconds without a card, stop scanning (it's likely the stack
  // is done or the phone was put down) and offer a button to carry on.
  const NO_CARD_TIMEOUT_MS = 5000;

  function pauseAuto() {
    state.paused = true;
    state.loopId++;
    hideBanner();
    setGuide(null);
    $('paused').hidden = false;
    setStatus('Auto-scan paused — no card seen for a few seconds.');
    beep('warn');
  }

  function hidePaused() { $('paused').hidden = true; }

  function resumeAuto() {
    armSounds();
    if (!state.auto || !state.stream) { hidePaused(); return; }
    state.lastRead = null;
    state.misses = 0;
    setStatus('Scanning — put a sticker in the box.');
    autoLoop();
  }


  // ----- motion: a hand or card moving through the scan area -----
  // Compares tiny grayscale snapshots of the scan area ~10x a second. Only a
  // big change (many pixels changing a lot) counts — camera noise and slow
  // exposure drift don't. Taps on the screen are ignored briefly, since
  // tapping a phone on a stand can shake it.
  const MOTION_SETTLE_MS = 400;
  const motion = { prev: null, lastAt: 0, ignoreUntil: 0, canvas: document.createElement('canvas') };

  function sampleMotion() {
    const g = guideRect();
    if (!g) return;
    const c = motion.canvas;
    c.width = 48;
    c.height = Math.max(8, Math.round(48 * g.h / g.w));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, g.x, g.y, g.w, g.h, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const gray = new Uint8Array(c.width * c.height);
    for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    const prev = motion.prev;
    motion.prev = gray;
    if (!prev || prev.length !== gray.length || performance.now() < motion.ignoreUntil) return;
    let changed = 0;
    for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - prev[i]) > 30) changed++;
    if (changed > gray.length * 0.08) onMotion();
  }

  function onMotion() {
    motion.lastAt = performance.now();
    if (state.lockedId && !state.disturbed) {
      state.disturbed = true;
      state.lastRead = null;
      hideBanner();
      setGuide(null);
      setStatus('Next card…');
    }
  }

  setInterval(() => { if (state.auto && !state.paused && state.stream && $('area-editor').hidden) sampleMotion(); }, 100);
  document.addEventListener('pointerdown', () => {
    motion.ignoreUntil = performance.now() + 1000;
    armSounds();
  }, true);

  function lockOn(id) {
    state.lockedId = id;
    state.disturbed = false;
  }

  function handleAutoRead(r) {
    const newCopy = state.disturbed;   // something was placed since the last add
    if (r && r.reason === 'skewed') {
      // The card is there, just crooked: not a "card removed" frame.
      setGuide(null);
      state.lastRead = null;
      state.misses = 0;
      setStatus(rescanMessage(r));
      if (state.lockedId && !newCopy) return;   // the added card got nudged; keep the ✓
      showBanner('warn', 'Straighten the card', `Tilted about ${Math.round(Math.abs(r.skew))}°`);
      if (!state.warned) { beep('warn'); state.warned = true; }
      return;
    }
    const id = r && r.confident ? Catalog.stickerId(r.code, r.number) : null;
    if (!id) {
      // Nothing readable: after two such frames the card has left the box.
      setGuide(null);
      if (++state.misses >= 2) {
        // Card gone: ready for the next one.
        lockOn(null);
        state.warned = false;
        hideBanner();
      }
      state.lastRead = null;
      setStatus(state.lockedId ? 'Next sticker…' : 'Ready — put a sticker in the box.');
      return;
    }
    state.misses = 0;
    state.warned = false;
    const sameCard = id === state.lockedId && !newCopy;
    // A new card: clear the banner so an old ✓ never looks like it belongs to it.
    if (!sameCard) hideBanner();
    if (sameCard) {
      setGuide('hit');
      setStatus(`${id} added — stack the next sticker.`);
      state.lastRead = id;
      return;
    }
    if (state.autoAdd) {
      // Only add on sure reads, seen on two frames in a row.
      if (r.sure && id === state.lastRead) {
        setGuide('hit');
        addSticker(r.code, r.number, 1);
        afterAdd(r.code, r.number, 1);
        lockOn(id);
      } else {
        setStatus(`Seeing ${id}… hold steady`);
      }
      state.lastRead = r.sure ? id : null;
      return;
    }
    setGuide('hit');
    openSheet(r);
    state.lastRead = id;
  }

  // ----------------------------------------------------------- the sheet --
  const teamSelect = $('sheet-team');
  teamSelect.innerHTML = '<option value="">Choose team…</option>' + TEAMS.map(t =>
    `<option value="${t.code}">${t.code} — ${t.name}${t.group ? ' (Group ' + t.group + ')' : ''}</option>`
  ).join('');

  function openSheet(r) {
    teamSelect.value = r.code || '';
    $('sheet-number').value = r.number ?? '';
    $('sheet-qty').value = 1;
    $('sheet-error').textContent = '';
    $('sheet-read').textContent = r.code
      ? (r.sure ? 'Check it, then add.' : 'Not completely sure about this one — please check.')
      : 'Pick the team and number.';
    $('sheet-title').textContent = r.code && r.number !== null && r.number !== undefined
      ? `Add ${r.code} ${r.number}` : 'Add sticker';
    updateSheetInfo();
    $('sheet').hidden = false;
    if (!r.code) teamSelect.focus();
    else if (r.number === null || r.number === undefined) $('sheet-number').focus();
  }

  function closeSheet() {
    $('sheet').hidden = true;
    setGuide(null);
  }

  function updateSheetInfo() {
    const t = BY_CODE[teamSelect.value];
    const num = $('sheet-number');
    num.min = t ? t.min : 0;
    num.max = t ? t.max : 20;
    const n = parseInt(num.value, 10);
    const have = t && inRange(t.code, n) ? (state.items[Catalog.stickerId(t.code, n)] || 0) : 0;
    $('sheet-existing').textContent = have ? `You already have ${have} spare${have > 1 ? 's' : ''} of ${t.code} ${n}.` : '';
    if (t && Number.isInteger(n)) $('sheet-title').textContent = `Add ${t.code} ${n}`;
  }

  function submitSheet() {
    const code = teamSelect.value;
    const n = parseInt($('sheet-number').value, 10);
    const qty = parseInt($('sheet-qty').value, 10) || 1;
    const t = BY_CODE[code];
    if (!t) { $('sheet-error').textContent = 'Choose a team.'; return; }
    if (!inRange(code, n)) { $('sheet-error').textContent = `${code} stickers go from ${t.min} to ${t.max}.`; return; }
    addSticker(code, n, qty);
    closeSheet();
    afterAdd(code, n, qty);
    // In auto mode (asking each time), don't immediately re-offer this card.
    lockOn(Catalog.stickerId(code, n));
    state.lastRead = state.lockedId;
  }

  function afterAdd(code, n, qty) {
    const id = Catalog.stickerId(code, n);
    beep('ok');
    if (state.auto) {
      const have = state.items[id];
      showBanner('ok', `✓ ${id}${qty > 1 ? ' ×' + qty : ''}`, `Added (${have} spare${have > 1 ? 's' : ''}) · Next sticker`);
    }
    state.recent.unshift({ id, qty });
    state.recent = state.recent.slice(0, 8);
    renderRecent();
    setStatus(`Added ${id}${qty > 1 ? ' ×' + qty : ''}. You have ${state.items[id]} spare${state.items[id] > 1 ? 's' : ''}.`);
    state.undoStack.push({ code, n, qty, id });
    if (state.undoStack.length > 50) state.undoStack.shift();
    renderUndo();
    showToast(`Added ${id}${qty > 1 ? ' ×' + qty : ''}`, true);
  }

  // Undo the most recent add (repeatable: each tap goes one further back).
  function undoLast() {
    const last = state.undoStack.pop();
    if (!last) return;
    addSticker(last.code, last.n, -last.qty);
    const i = state.recent.findIndex(r => r.id === last.id && r.qty === last.qty);
    if (i >= 0) state.recent.splice(i, 1);
    renderRecent();
    renderUndo();
    hideToast();
    // Stay locked on this card (auto-scan) so it isn't immediately re-added.
    hideBanner();
    const left = state.items[last.id] || 0;
    setStatus(`Undid ${last.id}${last.qty > 1 ? ' ×' + last.qty : ''} — ${left} spare${left === 1 ? '' : 's'} left.`);
    beep('warn');
  }

  function renderUndo() {
    const last = state.undoStack[state.undoStack.length - 1];
    const btn = $('undo-last');
    btn.disabled = !last;
    $('undo-what').textContent = last ? `${last.id}${last.qty > 1 ? ' ×' + last.qty : ''}` : '';
    btn.setAttribute('aria-label', last ? `Undo ${last.id}${last.qty > 1 ? ' times ' + last.qty : ''}` : 'Undo');
  }

  // -------------------------------------------------------------- feedback --
  // For batch scanning from a stand: a sound plus a big banner on the camera
  // view, so you can tell from a glance (or without looking) when to swap in
  // the next sticker.
  //
  // The beeps are rendered once into tiny WAV clips and played through
  // <audio> elements, not synthesised live with Web Audio: on iPhones Web
  // Audio is muted by the ring/silent switch, and it's suspended when the
  // camera starts and only resumes on a tap — which never comes in auto-scan.
  // An <audio> element that has been played once from a tap can be replayed
  // any time afterwards.
  const SOUNDS = {
    ok: { notes: [[880, 0, 0.09], [1320, 0.1, 0.16]], wave: 'sine', volume: 0.9 },
    warn: { notes: [[220, 0, 0.14], [196, 0.18, 0.22]], wave: 'square', volume: 0.35 },
  };
  const players = {};

  function renderWav({ notes, wave, volume }) {
    const rate = 22050;
    const total = Math.max(...notes.map(([, start, len]) => start + len)) + 0.05;
    const n = Math.ceil(rate * total);
    const samples = new Float32Array(n);
    for (const [freq, start, len] of notes) {
      for (let i = Math.floor(start * rate); i < Math.min(n, (start + len) * rate); i++) {
        const t = i / rate - start;
        const env = Math.min(1, t / 0.005) * (1 - t / len) ** 2;
        const osc = Math.sin(2 * Math.PI * freq * t);
        samples[i] += (wave === 'square' ? Math.sign(osc) : osc) * env * volume;
      }
    }
    const buf = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, text) => { for (let i = 0; i < text.length; i++) buf.setUint8(o + i, text.charCodeAt(i)); };
    str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
    buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
    str(36, 'data'); buf.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // Call from a tap: creates the players and plays each one silently once,
  // which is what lets iOS play them later without a tap.
  function armSounds() {
    for (const kind of Object.keys(SOUNDS)) {
      let p = players[kind];
      if (!p) {
        p = players[kind] = new Audio(renderWav(SOUNDS[kind]));
        p.preload = 'auto';
        p.armed = false;
      }
      if (p.armed || p.arming) continue;
      p.arming = true;
      p.muted = true;
      p.ready = p.play().then(() => {
        p.pause();
        p.currentTime = 0;
        p.armed = true;
      }, () => {}).finally(() => {
        p.muted = false;
        p.arming = false;
      });
    }
  }

  function beep(kind) {
    if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [60, 60, 60]);
    const p = players[kind];
    if (!$('sound').checked || !p) return;
    // Wait for a silent arming play still in flight, or it would cut this off.
    (p.ready || Promise.resolve()).then(() => {
      p.currentTime = 0;
      return p.play();
    }).catch(() => {});
  }

  function showBanner(kind, main, sub) {
    const b = $('banner');
    b.className = 'banner ' + kind;
    $('banner-main').textContent = main;
    $('banner-sub').textContent = sub || '';
    // Restart the pop animation for a new message.
    if (!b.hidden) { b.hidden = true; void b.offsetWidth; }
    b.hidden = false;
  }

  function hideBanner() { $('banner').hidden = true; }

  // ----------------------------------------------------------------- toast --
  let toastTimer = null;
  function showToast(text, withUndo) {
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !withUndo;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, withUndo ? 8000 : 4000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('toast').hidden = true;
  }

  // ------------------------------------------------------------- rendering --
  function setStatus(s) { $('status').textContent = s; }

  function renderRecent() {
    $('recent-title').hidden = !state.recent.length;
    $('recent').innerHTML = state.recent.map(r => {
      const have = state.items[r.id] || 0;
      return `<li><span class="code-chip">${escapeHtml(r.id)}</span>` +
        `<span class="recent-added">${r.qty > 1 ? '+' + r.qty : '+1'}</span>` +
        `<span class="qty">${have} spare${have === 1 ? '' : 's'}</span></li>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    renderCatalogPicker();
    const entries = Catalog.sortedEntries(state.items);
    const total = entries.reduce((s, e) => s + e.qty, 0);
    const teams = new Set(entries.map(e => e.code));
    $('total-badge').textContent = `${total} spare${total === 1 ? '' : 's'}`;
    $('summary').innerHTML =
      `<div><b>${total}</b><span>Spares</span></div>` +
      `<div><b>${entries.length}</b><span>Different</span></div>` +
      `<div><b>${teams.size}</b><span>Teams</span></div>`;

    const q = $('filter').value.trim().toUpperCase();
    const groups = new Map();
    for (const e of entries) {
      const t = BY_CODE[e.code];
      if (q && !(e.id.includes(q) || (t && t.name.toUpperCase().includes(q)))) continue;
      if (!groups.has(e.code)) groups.set(e.code, []);
      groups.get(e.code).push(e);
    }

    if (!entries.length) {
      $('catalog-list').innerHTML = '<div class="empty"><span class="code-chip muted">— —</span><p>No spares in this catalog yet.<br>Scan the back of a sticker to add it.</p></div>';
    } else if (!groups.size) {
      $('catalog-list').innerHTML = '<div class="empty"><p>Nothing matches that filter.</p></div>';
    } else {
      $('catalog-list').innerHTML = [...groups].map(([code, list]) => {
        const t = BY_CODE[code];
        const count = list.reduce((s, e) => s + e.qty, 0);
        return `<section class="team"><h3><span class="team-code">${escapeHtml(code)}</span>` +
          `<span class="team-name">${escapeHtml(t ? t.name : '')}${t && t.group ? `<small>Group ${t.group}</small>` : ''}</span>` +
          `<span class="team-count">${count}</span></h3><ul>` +
          list.map(e =>
            `<li><span class="code-chip">${escapeHtml(e.id)}</span>` +
            `<span class="stepper-inline">` +
            `<button data-id="${escapeHtml(e.id)}" data-d="-1" aria-label="One fewer ${escapeHtml(e.id)}">−</button>` +
            `<span class="count">${e.qty}</span>` +
            `<button data-id="${escapeHtml(e.id)}" data-d="1" aria-label="One more ${escapeHtml(e.id)}">+</button></span></li>`
          ).join('') + '</ul></section>';
      }).join('');
    }
    renderRecent();
  }

  $('catalog-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const { code, number } = Catalog.splitId(b.dataset.id);
    addSticker(code, number, parseInt(b.dataset.d, 10));
  });

  // ----------------------------------------------------- export / import --
  function csvFile() {
    const date = new Date().toISOString().slice(0, 10);
    const slug = currentCatalog().name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'swaps';
    return new File([Catalog.toCSV(state.items)], `panini-wc26-${slug}-${date}.csv`, { type: 'text/csv' });
  }

  function download() {
    const file = csvFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function share() {
    const file = csvFile();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Panini World Cup 2026 swaps — ${currentCatalog().name}` });
      } catch (e) {
        if (e.name !== 'AbortError') download();
      }
    } else {
      download();
    }
  }

  async function copyTradeText() {
    const text = Catalog.toTradeText(state.items, currentCatalog().name);
    try {
      await navigator.clipboard.writeText(text);
      showToast('Swap list copied — paste it into a chat');
    } catch (e) {
      if (navigator.share) navigator.share({ text }).catch(() => {});
      else window.prompt('Copy your swap list:', text);
    }
  }

  async function importCSV(file) {
    const text = await file.text();
    const { items, skipped } = Catalog.fromCSV(text);
    const ids = Object.keys(items);
    if (!ids.length) { showToast('No stickers found in that file'); return; }
    const count = ids.reduce((s, id) => s + items[id], 0);
    const replace = Object.keys(state.items).length &&
      !confirm(`Import ${count} stickers.\n\nOK = add them to your current catalog\nCancel = replace your current catalog`);
    if (replace) state.items = {};
    for (const id of ids) state.items[id] = (state.items[id] || 0) + items[id];
    save();
    render();
    showToast(`Imported ${count} stickers${skipped ? ` (${skipped} rows skipped)` : ''}`);
  }

  // ------------------------------------------------------------- catalogs --
  const catalogTotal = items => Object.values(items).reduce((a, q) => a + q, 0);

  function renderCatalogPicker() {
    const sel = $('catalog-select');
    sel.innerHTML = Object.entries(store.catalogs)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, c]) => `<option value="${id}">${escapeHtml(c.name)} (${catalogTotal(c.items)})</option>`)
      .join('') + '<option value="__new">＋ New catalog…</option>';
    sel.value = store.current;
  }

  function askCatalogName(message, current) {
    const name = (prompt(message, current || '') || '').trim().slice(0, 40);
    if (!name) return null;
    const taken = Object.entries(store.catalogs).some(([id, c]) => id !== store.current && c.name.toLowerCase() === name.toLowerCase());
    if (taken && name !== current) { alert(`There's already a catalog called “${name}”.`); return null; }
    return name;
  }

  function switchCatalog(id) {
    store.current = id;
    state.items = store.catalogs[id].items;
    state.recent = [];
    state.undoStack = [];
    state.lastRead = null;
    lockOn(null);
    hideBanner();
    hideToast();
    save();
    render();
    renderUndo();
    setStatus(`Now using the catalog “${currentCatalog().name}”.`);
  }

  $('catalog-select').addEventListener('change', e => {
    if (e.target.value !== '__new') { switchCatalog(e.target.value); return; }
    const name = askCatalogName('Name for the new catalog (e.g. “Sam’s swaps”):');
    if (!name) { renderCatalogPicker(); return; }
    const id = newCatalogId();
    store.catalogs[id] = { name, items: {}, updated: new Date().toISOString() };
    switchCatalog(id);
  });

  $('rename-btn').addEventListener('click', () => {
    const name = askCatalogName('New name for this catalog:', currentCatalog().name);
    if (!name) return;
    currentCatalog().name = name;
    save();
    render();
  });

  $('delete-btn').addEventListener('click', () => {
    const ids = Object.keys(store.catalogs);
    const cat = currentCatalog();
    if (ids.length === 1) { alert('This is your only catalog. Use “Clear this catalog” to empty it instead.'); return; }
    const n = catalogTotal(cat.items);
    if (!confirm(`Delete the catalog “${cat.name}”${n ? ` and its ${n} sticker${n === 1 ? '' : 's'}` : ''}? This can't be undone — export its CSV first if you want a copy.`)) return;
    delete store.catalogs[store.current];
    switchCatalog(ids.find(id => id !== store.current && store.catalogs[id]));
  });

  // ------------------------------------------------------------ scan area --
  // With a scanner stand the sticker is always in the same spot, so the user
  // can draw the box once (around the code label, or the whole sticker) and
  // it is remembered on this phone.
  function applyArea() {
    const g = $('guide'), a = state.area;
    g.classList.toggle('custom', !!a);
    if (a) {
      Object.assign(g.style, { left: a.x * 100 + '%', top: a.y * 100 + '%', width: a.w * 100 + '%', height: a.h * 100 + '%' });
    } else {
      g.removeAttribute('style');
    }
    $('area-label').textContent = a ? 'Scan area · custom' : 'Scan area';
    $('area-btn').classList.toggle('on', !!a);
  }

  let draft = null, dragStart = null;

  function drawDraft() {
    const el = $('area-draw');
    el.hidden = !draft;
    if (draft) {
      Object.assign(el.style, { left: draft.x * 100 + '%', top: draft.y * 100 + '%', width: draft.w * 100 + '%', height: draft.h * 100 + '%' });
    }
  }

  function openAreaEditor() {
    if (!state.stream) { setStatus('Start the camera first, then set the scan area.'); return; }
    closeSheet();
    draft = state.area ? { ...state.area } : null;
    drawDraft();
    $('area-editor').hidden = false;
    $('area-controls').hidden = false;
    $('guide').hidden = true;
    // The button sits below the camera: bring the camera into view to draw on.
    $('camera').scrollIntoView({ block: 'start' });
    setStatus('Drag on the camera view to draw the scan area.');
  }

  function closeAreaEditor() {
    $('area-editor').hidden = true;
    $('area-controls').hidden = true;
    $('guide').hidden = false;
    dragStart = null;
  }

  function pointerPos(e) {
    const r = $('area-editor').getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  $('area-editor').addEventListener('pointerdown', e => {
    dragStart = pointerPos(e);
    $('area-editor').setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  $('area-editor').addEventListener('pointermove', e => {
    if (!dragStart) return;
    const p = pointerPos(e);
    draft = {
      x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y),
    };
    drawDraft();
  });
  $('area-editor').addEventListener('pointerup', () => { dragStart = null; });
  $('area-editor').addEventListener('pointercancel', () => { dragStart = null; });

  $('area-btn').addEventListener('click', openAreaEditor);
  $('area-cancel').addEventListener('click', () => { closeAreaEditor(); setStatus('Scan area unchanged.'); });
  $('area-reset').addEventListener('click', () => {
    state.area = null;
    try { localStorage.removeItem(AREA_KEY); } catch (e) {}
    applyArea();
    closeAreaEditor();
    setStatus('Using the default sticker-shaped scan area.');
  });
  $('area-save').addEventListener('click', () => {
    if (!draft || draft.w < 0.04 || draft.h < 0.02) { setStatus('Draw a box first (drag on the camera view).'); return; }
    state.area = draft;
    try { localStorage.setItem(AREA_KEY, JSON.stringify(draft)); } catch (e) {}
    applyArea();
    closeAreaEditor();
    setStatus('Scan area saved. It stays set on this phone.');
  });

  // --------------------------------------------------------------- wiring --
  $('start-camera').addEventListener('click', () => { armSounds(); startCamera(); });
  try { $('sound').checked = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) {}
  $('sound').addEventListener('change', e => {
    armSounds();
    try { localStorage.setItem(SOUND_KEY, e.target.checked ? 'on' : 'off'); } catch (err) {}
    if (e.target.checked) beep('ok');
  });
  $('torch-btn').addEventListener('click', toggleTorch);
  $('scan-btn').addEventListener('click', () => { armSounds(); manualScan(); });
  $('manual-btn').addEventListener('click', () => openSheet({}));
  $('auto-scan').addEventListener('change', e => {
    armSounds();
    state.auto = e.target.checked;
    state.lastRead = null;
    lockOn(null);
    state.warned = false;
    hideBanner();
    hidePaused();
    $('scan-btn').hidden = state.auto;
    if (state.auto) {
      if (!state.stream) { setStatus('Start the camera to auto-scan.'); return; }
      autoLoop();
    } else {
      state.loopId++;
      state.paused = false;
      setStatus('Auto-scan off.');
    }
  });
  $('auto-add').addEventListener('change', e => { state.autoAdd = e.target.checked; });
  $('resume-btn').addEventListener('click', resumeAuto);

  teamSelect.addEventListener('change', updateSheetInfo);
  $('sheet-number').addEventListener('input', updateSheetInfo);
  $('qty-minus').addEventListener('click', () => { $('sheet-qty').value = Math.max(1, (parseInt($('sheet-qty').value, 10) || 1) - 1); });
  $('qty-plus').addEventListener('click', () => { $('sheet-qty').value = (parseInt($('sheet-qty').value, 10) || 0) + 1; });
  $('sheet-cancel').addEventListener('click', closeSheet);
  $('sheet-add').addEventListener('click', submitSheet);
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('sheet-number').addEventListener('keydown', e => { if (e.key === 'Enter') submitSheet(); });

  $('toast-undo').addEventListener('click', undoLast);
  $('undo-last').addEventListener('click', undoLast);

  $('filter').addEventListener('input', render);
  $('share-btn').addEventListener('click', share);
  $('download-btn').addEventListener('click', download);
  $('copy-btn').addEventListener('click', copyTradeText);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importCSV(f);
    e.target.value = '';
  });
  $('clear-btn').addEventListener('click', () => {
    if (!Object.keys(state.items).length) return;
    if (!confirm(`Remove every sticker from “${currentCatalog().name}”? Export a CSV first if you want a backup.`)) return;
    state.items = {};
    state.recent = [];
    state.undoStack = [];
    renderUndo();
    save();
    render();
  });

  applyArea();
  save();   // persists a carried-over or brand-new catalog store
  render();
  renderUndo();
})();
