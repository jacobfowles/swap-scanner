(function () {
  const { TEAMS, BY_CODE } = window.PaniniTeams;
  const { parseCodeLine, inRange } = window.PaniniParse;
  const Catalog = window.PaniniCatalog;
  const { prepareForOcr, findCodePill, clearBorder, isolateText } = window.PaniniPreprocess;

  const STORAGE_KEY = 'panini-wc26-swaps-v1';
  const AREA_KEY = 'panini-wc26-area-v1';
  const SOUND_KEY = 'panini-wc26-sound-v1';
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- state --
  const state = {
    items: load(),
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
    recent: [],
    undo: null,
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return data && data.items ? data.items : {};
    } catch (e) {
      return {};
    }
  }

  function loadArea() {
    try {
      const a = JSON.parse(localStorage.getItem(AREA_KEY));
      return a && a.w > 0.02 && a.h > 0.02 ? a : null;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, updated: new Date().toISOString() }));
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

  // Draw a rectangle of the current frame onto the work canvas at `targetW`
  // pixels wide; return its pixels.
  function grab(rect, targetW) {
    const k = targetW / rect.w;
    const canvas = $('work');
    canvas.width = Math.max(1, Math.round(rect.w * k));
    canvas.height = Math.max(1, Math.round(rect.h * k));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx, img: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }

  // The label as dark text on white: `height` px tall (Tesseract reads text
  // best around 40-60px high) with a white margin.
  function pillCanvas(rect, height) {
    const { canvas, ctx, img } = grab(rect, height * rect.w / rect.h);
    ctx.putImageData(isolateText(clearBorder(prepareForOcr(img, 'invert'))), 0, 0);
    const pad = 20;
    const out = document.createElement('canvas');
    out.width = canvas.width + 2 * pad;
    out.height = canvas.height + 2 * pad;
    const o = out.getContext('2d');
    o.fillStyle = '#fff';
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(canvas, pad, pad);
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
    return { rect, skew: p.angle * 180 / Math.PI };
  }

  const LINE = { tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' };

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
    if (pill && Math.abs(pill.skew) > MAX_SKEW_DEG) return { ...none, reason: 'skewed', skew: pill.skew };

    const passes = [];
    if (pill) for (const h of [120, 80, 60]) passes.push({ rect: pill.rect, h });
    // A box drawn tight around (or inside) the label: read the whole box too.
    if (custom) passes.push({ rect: guide, h: 120 });
    if (!passes.length) return { ...none, reason: 'no-label' };

    const votes = new Map();
    let first = null;
    for (const pass of passes) {
      const canvas = pillCanvas(pass.rect, pass.h);
      await worker.setParameters(LINE);
      const { data } = await worker.recognize(canvas);
      if (window.__scanDebug) window.__scanDebug.push({ mode: 'h' + pass.h, text: data.text, png: canvas.toDataURL() });
      const r = parseCodeLine(data.text);
      if (!r.confident) continue;
      const id = Catalog.stickerId(r.code, r.number);
      votes.set(id, (votes.get(id) || 0) + 1);
      if (!first) first = r;
      if (votes.get(id) >= 2) return { ...r, sure: true };
    }
    if (!first) return { ...none, reason: 'unreadable' };
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
    while (state.auto && state.stream) {
      const still = performance.now() - motion.lastAt > MOTION_SETTLE_MS;
      if (still && $('sheet').hidden && $('area-editor').hidden && !state.scanning) {
        state.scanning = true;
        setGuide('busy');
        const startedAt = performance.now();
        let r;
        try { r = await scanOnce(); } catch (e) { r = null; }
        state.scanning = false;
        if (!state.auto) break;
        // Something moved while reading: that frame may be the old card.
        if (motion.lastAt <= startedAt) handleAutoRead(r);
      }
      await new Promise(res => setTimeout(res, still ? 250 : 80));
    }
    setGuide(null);
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

  setInterval(() => { if (state.auto && state.stream && $('area-editor').hidden) sampleMotion(); }, 100);
  document.addEventListener('pointerdown', () => { motion.ignoreUntil = performance.now() + 1000; }, true);

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
    showToast(`Added ${id}${qty > 1 ? ' ×' + qty : ''}`, () => {
      addSticker(code, n, -qty);
      state.recent = state.recent.filter((r, i) => !(i === 0 && r.id === id));
      renderRecent();
      setStatus(`Removed ${id}.`);
      // Stay locked on this card so it isn't immediately re-added.
      hideBanner();
    });
  }

  // -------------------------------------------------------------- feedback --
  // For batch scanning from a stand: a sound plus a big banner on the camera
  // view, so you can tell from a glance (or without looking) when to swap in
  // the next sticker.
  let audio = null;
  function unlockAudio() {
    // Browsers (iOS especially) only allow sound after a tap; call from one.
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }

  function beep(kind) {
    if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [60, 60, 60]);
    if (!$('sound').checked || !audio) return;
    const notes = kind === 'ok' ? [[880, 0, 0.09], [1320, 0.1, 0.14]] : [[220, 0, 0.12], [196, 0.16, 0.2]];
    const t0 = audio.currentTime + 0.01;
    for (const [freq, start, len] of notes) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = kind === 'ok' ? 'sine' : 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(kind === 'ok' ? 0.4 : 0.15, t0 + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + len + 0.02);
    }
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
  function showToast(text, undo) {
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !undo;
    state.undo = undo || null;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; state.undo = null; }, 4000);
  }

  // ------------------------------------------------------------- rendering --
  function setStatus(s) { $('status').textContent = s; }

  function renderRecent() {
    $('recent').innerHTML = state.recent.map(r =>
      `<li><span>${r.id}${r.qty > 1 ? ' ×' + r.qty : ''}</span><span class="qty">${state.items[r.id] || 0} spare(s)</span></li>`
    ).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    const entries = Catalog.sortedEntries(state.items);
    const total = entries.reduce((s, e) => s + e.qty, 0);
    const teams = new Set(entries.map(e => e.code));
    $('total-badge').textContent = `${total} spare${total === 1 ? '' : 's'}`;
    $('summary').innerHTML =
      `<div><b>${total}</b><span>spares</span></div>` +
      `<div><b>${entries.length}</b><span>different</span></div>` +
      `<div><b>${teams.size}</b><span>teams</span></div>`;

    const q = $('filter').value.trim().toUpperCase();
    const groups = new Map();
    for (const e of entries) {
      const t = BY_CODE[e.code];
      if (q && !(e.id.includes(q) || (t && t.name.toUpperCase().includes(q)))) continue;
      if (!groups.has(e.code)) groups.set(e.code, []);
      groups.get(e.code).push(e);
    }

    if (!entries.length) {
      $('catalog-list').innerHTML = '<p class="empty">No spares yet. Scan the back of a sticker to add it.</p>';
    } else if (!groups.size) {
      $('catalog-list').innerHTML = '<p class="empty">Nothing matches that filter.</p>';
    } else {
      $('catalog-list').innerHTML = [...groups].map(([code, list]) => {
        const t = BY_CODE[code];
        const count = list.reduce((s, e) => s + e.qty, 0);
        return `<div class="team"><h3>${escapeHtml(code)} — ${escapeHtml(t ? t.name : '')}<small>${count}</small></h3><ul>` +
          list.map(e =>
            `<li><span class="id">${escapeHtml(e.id)}</span>` +
            `<button data-id="${escapeHtml(e.id)}" data-d="-1" aria-label="One fewer">−</button>` +
            `<span class="count">${e.qty}</span>` +
            `<button data-id="${escapeHtml(e.id)}" data-d="1" aria-label="One more">+</button></li>`
          ).join('') + '</ul></div>';
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
    return new File([Catalog.toCSV(state.items)], `panini-wc26-swaps-${date}.csv`, { type: 'text/csv' });
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
        await navigator.share({ files: [file], title: 'Panini World Cup 2026 swaps' });
      } catch (e) {
        if (e.name !== 'AbortError') download();
      }
    } else {
      download();
    }
  }

  async function copyTradeText() {
    const text = Catalog.toTradeText(state.items);
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
    $('area-btn').textContent = a ? 'Scan area (custom)' : 'Scan area';
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
  $('start-camera').addEventListener('click', () => { unlockAudio(); startCamera(); });
  try { $('sound').checked = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) {}
  $('sound').addEventListener('change', e => {
    unlockAudio();
    try { localStorage.setItem(SOUND_KEY, e.target.checked ? 'on' : 'off'); } catch (err) {}
    if (e.target.checked) beep('ok');
  });
  $('torch-btn').addEventListener('click', toggleTorch);
  $('scan-btn').addEventListener('click', () => { unlockAudio(); manualScan(); });
  $('manual-btn').addEventListener('click', () => openSheet({}));
  $('auto-scan').addEventListener('change', e => {
    unlockAudio();
    state.auto = e.target.checked;
    state.lastRead = null;
    lockOn(null);
    state.warned = false;
    hideBanner();
    $('scan-btn').hidden = state.auto;
    if (state.auto) {
      if (!state.stream) { setStatus('Start the camera to auto-scan.'); return; }
      autoLoop();
    } else {
      setStatus('Auto-scan off.');
    }
  });
  $('auto-add').addEventListener('change', e => { state.autoAdd = e.target.checked; });

  teamSelect.addEventListener('change', updateSheetInfo);
  $('sheet-number').addEventListener('input', updateSheetInfo);
  $('qty-minus').addEventListener('click', () => { $('sheet-qty').value = Math.max(1, (parseInt($('sheet-qty').value, 10) || 1) - 1); });
  $('qty-plus').addEventListener('click', () => { $('sheet-qty').value = (parseInt($('sheet-qty').value, 10) || 0) + 1; });
  $('sheet-cancel').addEventListener('click', closeSheet);
  $('sheet-add').addEventListener('click', submitSheet);
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('sheet-number').addEventListener('keydown', e => { if (e.key === 'Enter') submitSheet(); });

  $('toast-undo').addEventListener('click', () => {
    if (state.undo) state.undo();
    state.undo = null;
    $('toast').hidden = true;
  });

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
    if (!confirm('Delete every sticker from the catalog? Export a CSV first if you want a backup.')) return;
    state.items = {};
    state.recent = [];
    save();
    render();
  });

  applyArea();
  render();
})();
