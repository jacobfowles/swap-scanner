// Image clean-up before OCR, on raw RGBA pixels ({ data, width, height }).
//
// The sticker code sits in a dark pill with white text, while the rest of the
// back is dark text on light grey. Tesseract wants dark text on a light
// background, so in 'auto' mode every pixel whose surroundings are dark gets
// inverted — the pill turns light with dark text and the light areas are left
// alone. Then contrast is stretched to the full range.
(function (root) {
  function toGray(img) {
    const d = img.data, n = img.width * img.height;
    const g = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    }
    return g;
  }

  // Otsu's threshold: the gray level that best splits dark from light.
  function otsu(g) {
    const hist = new Float64Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, best = 0, t = 128;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (!wB) continue;
      const wF = g.length - wB;
      if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = v; }
    }
    return t;
  }

  // Mean gray level in a (2r+1)^2 box around every pixel, via an integral image.
  function boxMean(g, w, h, r) {
    const W = w + 1;
    const ii = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += g[y * w + x];
        ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + row;
      }
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const s = ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0];
        out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  }

  // mode: 'auto' (flip dark regions), 'invert' (flip everything), 'plain'.
  function prepareForOcr(img, mode) {
    const { width: w, height: h, data } = img;
    const g = toGray(img);

    if (mode === 'auto') {
      const t = otsu(g);
      const mean = boxMean(g, w, h, Math.max(8, Math.round(Math.min(w, h) / 10)));
      for (let i = 0; i < g.length; i++) if (mean[i] < t) g[i] = 255 - g[i];
    } else if (mode === 'invert') {
      for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
    }

    // Stretch the 2nd..98th percentile to the full range.
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > g.length * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > g.length * 0.02) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) {
      const y = (g[j] - lo) * 255 / range;
      data[i] = data[i + 1] = data[i + 2] = y;
      data[i + 3] = 255;
    }
    return img;
  }

  // Find the dark rounded label holding the code (e.g. "NZL 3") on a sticker
  // back: a solid dark blob, roughly 2-7x wider than tall, 12-55% of the
  // image width, and in the top half. Returns its bounding box { x, y, w, h }
  // plus centre (cx, cy), length, thickness and tilt angle (radians), or null.
  // Works on a small image (~300px wide) for speed. `maxWidth` can be raised
  // when the image is a user-drawn box tight around the label.
  function findCodePill(img, { maxWidth = 0.55 } = {}) {
    const { width: w, height: h } = img;
    const g = toGray(img);
    const t = otsu(g);
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) dark[i] = g[i] < t ? 1 : 0;

    // Close small gaps (the white letters) so the label is one blob: a
    // horizontal then vertical run fill over short light gaps.
    const gapX = Math.max(2, Math.round(w / 40)), gapY = Math.max(2, Math.round(h / 60));
    const filled = dark.slice();
    for (let y = 0; y < h; y++) {
      let last = -1;
      for (let x = 0; x < w; x++) {
        if (!dark[y * w + x]) continue;
        if (last >= 0 && x - last > 1 && x - last <= gapX) for (let k = last + 1; k < x; k++) filled[y * w + k] = 1;
        last = x;
      }
    }
    const closed = filled.slice();
    for (let x = 0; x < w; x++) {
      let last = -1;
      for (let y = 0; y < h; y++) {
        if (!filled[y * w + x]) continue;
        if (last >= 0 && y - last > 1 && y - last <= gapY) for (let k = last + 1; k < y; k++) closed[k * w + x] = 1;
        last = y;
      }
    }

    // Connected components (4-neighbour flood fill).
    const label = new Int32Array(w * h);
    const stack = [];
    let best = null, next = 0;
    for (let s = 0; s < w * h; s++) {
      if (!closed[s] || label[s]) continue;
      next++;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      stack.push(s);
      label[s] = next;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p - px) / w;
        area++;
        sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0 && closed[p - 1] && !label[p - 1]) { label[p - 1] = next; stack.push(p - 1); }
        if (px < w - 1 && closed[p + 1] && !label[p + 1]) { label[p + 1] = next; stack.push(p + 1); }
        if (py > 0 && closed[p - w] && !label[p - w]) { label[p - w] = next; stack.push(p - w); }
        if (py < h - 1 && closed[p + w] && !label[p + w]) { label[p + w] = next; stack.push(p + w); }
      }
      // Orientation and true length/width from second moments, so a tilted
      // label is still recognised (and can be rejected as skewed by the
      // caller) instead of being missed because its bounding box looks square.
      const cx = sx / area, cy = sy / area;
      const vxx = sxx / area - cx * cx, vyy = syy / area - cy * cy, vxy = sxy / area - cx * cy;
      const angle = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
      const mid = (vxx + vyy) / 2, dev = Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy);
      const len = Math.sqrt(12 * (mid + dev)), thick = Math.sqrt(12 * Math.max(0, mid - dev));
      if (!thick || Math.abs(angle) > 0.35) continue;
      const aspect = len / thick, fill = area / (len * thick);
      if (aspect < 2 || aspect > 7) continue;
      if (len < w * 0.12 || len > w * maxWidth) continue;
      if (fill < 0.6 || y0 > h * 0.5) continue;
      // Prefer big, solid, high-up blobs.
      const score = area * Math.min(1, fill) * (1 - y0 / h);
      if (!best || score > best.score) best = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, cx, cy, len, thick, angle, score };
    }
    if (!best) return null;
    delete best.score;
    return best;
  }

  // After inverting a crop of the pill, everything outside the pill is dark
  // and touches the edge. Paint that white so only the code is left — a dark
  // frame makes Tesseract skip the line altogether.
  function clearBorder(img) {
    const { width: w, height: h, data: px } = img;
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const i = stack.pop();
      if (seen[i] || px[i * 4] >= 128) continue;
      seen[i] = 1;
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
    return img;
  }

  // Keep only letter-sized dark shapes and redraw them pure black on white.
  // Drops what is left of the pill's outline (tall, or as wide as the label),
  // which Tesseract otherwise reads as "C" / "(" or treats as a box.
  function isolateText(img) {
    const { width: w, height: h, data: px } = img;
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) dark[i] = px[i * 4] < 128 ? 1 : 0;
    const keep = new Uint8Array(w * h);
    const label = new Int32Array(w * h);
    const stack = [], members = [];
    let next = 0;
    for (let s = 0; s < w * h; s++) {
      if (!dark[s] || label[s]) continue;
      next++;
      members.length = 0;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      stack.push(s);
      label[s] = next;
      while (stack.length) {
        const p = stack.pop();
        members.push(p);
        const x = p % w, y = (p - x) / w;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && dark[q] && !label[q]) { label[q] = next; stack.push(q); }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bh >= h * 0.12 && bh <= h * 0.55 && bw <= w * 0.4 && members.length >= 12) {
        for (const p of members) keep[p] = 1;
      }
    }
    for (let i = 0; i < w * h; i++) {
      const v = keep[i] ? 0 : 255;
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
    }
    return img;
  }

  const api = { prepareForOcr, otsu, findCodePill, clearBorder, isolateText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaniniPreprocess = api;
})(this);
