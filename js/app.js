(function () {
  const { TEAMS, BY_CODE } = window.PaniniTeams;
  const { parseCardText, inRange } = window.PaniniParse;
  const Catalog = window.PaniniCatalog;

  const STORAGE_KEY = 'panini-wc26-swaps-v1';
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- state --
  const state = {
    items: load(),
    stream: null,
    torchOn: false,
    scanning: false,
    auto: false,
    autoAdd: false,
    lastRead: null,     // id read on the previous frame (auto mode)
    lockedId: null,     // id just auto-added; wait for the card to change
    misses: 0,
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
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
        return worker;
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // Copy the part of the video under the guide box onto a canvas, grayscale
  // and contrast-stretched. `invert` handles light text on a dark print.
  function grabGuideRegion(invert) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const box = video.getBoundingClientRect();
    const g = $('guide').getBoundingClientRect();
    // object-fit: cover — work out which part of the frame is on screen.
    const scale = Math.max(box.width / vw, box.height / vh);
    const ox = (box.width - vw * scale) / 2, oy = (box.height - vh * scale) / 2;
    const sx = Math.max(0, (g.left - box.left - ox) / scale);
    const sy = Math.max(0, (g.top - box.top - oy) / scale);
    const sw = Math.min(vw - sx, g.width / scale);
    const sh = Math.min(vh - sy, g.height / scale);

    const targetW = 1400;
    const k = targetW / sw;
    const canvas = $('work');
    canvas.width = Math.round(sw * k);
    canvas.height = Math.round(sh * k);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = y;
      hist[y]++;
    }
    // Stretch the 2nd..98th percentile to full range.
    const n = d.length / 4;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let y = Math.min(255, Math.max(0, (d[i] - lo) * 255 / range));
      if (invert) y = 255 - y;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  async function scanOnce() {
    const worker = await getWorker();
    let best = null, rawText = '';
    for (const invert of [false, true]) {
      const canvas = grabGuideRegion(invert);
      if (!canvas) break;
      const { data } = await worker.recognize(canvas);
      rawText += data.text + '\n';
      const r = parseCardText(data.text);
      if (r.confident) return { ...r, rawText };
      if (!best && r.code) best = r;
    }
    return { ...(best || parseCardText('')), rawText };
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
      if (r.code) {
        setGuide('hit');
        setStatus(r.confident ? `Read ${r.code} ${r.number}.` : `Found ${BY_CODE[r.code].name} — check the number.`);
      } else {
        setGuide(null);
        setStatus("Couldn't read a sticker code. Try more light, hold steady, or type it in.");
      }
      openSheet(r);
    } catch (e) {
      setGuide(null);
      setStatus('The text reader is not available. You can type stickers in.');
      openSheet({});
    } finally {
      state.scanning = false;
      $('scan-btn').disabled = !state.stream;
    }
  }

  // Auto mode keeps reading frames. With "add without asking" on, a sticker
  // is added once the same code is read on two frames in a row; the same code
  // is then ignored until the card leaves the box (so a pile of identical
  // duplicates still works: take it away, put the next one in).
  async function autoLoop() {
    while (state.auto && state.stream) {
      if ($('sheet').hidden && !state.scanning) {
        state.scanning = true;
        setGuide('busy');
        let r;
        try { r = await scanOnce(); } catch (e) { r = null; }
        state.scanning = false;
        if (!state.auto) break;
        handleAutoRead(r);
      }
      await new Promise(res => setTimeout(res, 250));
    }
    setGuide(null);
  }

  function handleAutoRead(r) {
    const id = r && r.confident ? Catalog.stickerId(r.code, r.number) : null;
    if (!id) {
      setGuide(null);
      if (++state.misses >= 2) state.lockedId = null;
      state.lastRead = null;
      setStatus(state.lockedId ? 'Next sticker…' : 'Looking for a sticker code…');
      return;
    }
    state.misses = 0;
    if (id === state.lockedId) {
      setGuide('hit');
      setStatus(`${id} added — show the next sticker.`);
      state.lastRead = id;
      return;
    }
    if (state.autoAdd) {
      if (id === state.lastRead) {
        setGuide('hit');
        addSticker(r.code, r.number, 1);
        afterAdd(r.code, r.number, 1);
        state.lockedId = id;
      } else {
        setStatus(`Seeing ${id}… hold steady`);
      }
    } else {
      setGuide('hit');
      openSheet(r);
    }
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
    const raw = (r.rawText || '').replace(/\s+/g, ' ').trim();
    $('sheet-read').textContent = r.code
      ? (r.confident ? 'Check it, then add.' : 'Team found but not sure about the number — please check.')
      : (raw ? 'Could not find a code. Pick the team and number.' : 'Pick the team and number.');
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
    state.lockedId = Catalog.stickerId(code, n);
    state.lastRead = state.lockedId;
  }

  function afterAdd(code, n, qty) {
    const id = Catalog.stickerId(code, n);
    if (navigator.vibrate) navigator.vibrate(60);
    state.recent.unshift({ id, qty });
    state.recent = state.recent.slice(0, 8);
    renderRecent();
    setStatus(`Added ${id}${qty > 1 ? ' ×' + qty : ''}. You have ${state.items[id]} spare${state.items[id] > 1 ? 's' : ''}.`);
    showToast(`Added ${id}${qty > 1 ? ' ×' + qty : ''}`, () => {
      addSticker(code, n, -qty);
      state.recent = state.recent.filter((r, i) => !(i === 0 && r.id === id));
      renderRecent();
      setStatus(`Removed ${id}.`);
      if (state.lockedId === id) state.lockedId = null;
    });
  }

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

  // --------------------------------------------------------------- wiring --
  $('start-camera').addEventListener('click', startCamera);
  $('torch-btn').addEventListener('click', toggleTorch);
  $('scan-btn').addEventListener('click', manualScan);
  $('manual-btn').addEventListener('click', () => openSheet({}));
  $('auto-scan').addEventListener('change', e => {
    state.auto = e.target.checked;
    state.lastRead = state.lockedId = null;
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

  render();
})();
