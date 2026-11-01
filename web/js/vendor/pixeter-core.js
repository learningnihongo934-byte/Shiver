// Copied from PixeterWeb/public/js/core.js (Pixeter by Virat Reddy Kaukuntla) so Shiver can import .pixeter files.
// Refresh with: ./build.sh sync-pixeter
// Pixeter core: document model, drawing algorithms, compositing, GIF encoding, (de)serialisation.
// Pure JS with no DOM access, shared by the web editor and the Claude Code MCP server (build.py inlines it).

export const VERSION = 1;
export const MAX_SIZE = 1024; // canvases up to 1024x1024 (scenes like 256x144, 480x270 or 1024x576)

export const PALETTES = {
  "Pixeter 32": ["#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a", "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74", "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87", "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30"],
  "PICO-8": ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
  "Sweetie 16": ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"],
  "Endesga 32": ["#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633", "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e", "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466", "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569"],
  "Game Boy": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  "NES": ["#000000", "#fcfcfc", "#f8f8f8", "#bcbcbc", "#7c7c7c", "#a4e4fc", "#3cbcfc", "#0078f8", "#0000fc", "#b8b8f8", "#6888fc", "#0058f8", "#0000bc", "#d8b8f8", "#9878f8", "#6844fc", "#4428bc", "#f8b8f8", "#f878f8", "#d800cc", "#940084", "#f8a4c0", "#f85898", "#e40058", "#a80020", "#f0d0b0", "#f87858", "#f83800", "#a81000", "#fce0a8", "#fca044", "#e45c10", "#881400", "#f8d878", "#f8b800", "#ac7c00", "#503000", "#d8f878", "#b8f818", "#00b800", "#007800", "#b8f8b8", "#58d854", "#00a800", "#006800", "#b8f8d8", "#58f898", "#00a844", "#005800", "#00fcfc", "#00e8d8", "#008888", "#004058", "#f8d8f8", "#787878"],
  "Grayscale": ["#000000", "#1f1f1f", "#3f3f3f", "#5f5f5f", "#7f7f7f", "#9f9f9f", "#bfbfbf", "#dfdfdf", "#ffffff"],
};

let _id = 0;
export const uid = (p = "id") => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`;

// ---------- colours ----------
export function hexToRgba(hex) {
  if (Array.isArray(hex)) return hex.length === 4 ? hex : [...hex, 255];
  if (hex == null || hex === "transparent" || hex === "") return [0, 0, 0, 0];
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) throw new Error(`Bad colour "${hex}" (use #rrggbb or #rrggbbaa)`);
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) : 255];
}
export function rgbaToHex([r, g, b, a = 255]) {
  const s = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return a === 255 ? s : s + a.toString(16).padStart(2, "0");
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
export function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255); };
  return [f(5), f(3), f(1)];
}
// Shade a colour: amount > 0 lightens, < 0 darkens (hue-shifted like hand pixel art: warmer lights, cooler shadows).
export function shade([r, g, b, a], amount) {
  if (!a) return [r, g, b, a];
  let [h, s, v] = rgbToHsv(r, g, b);
  v = Math.min(1, Math.max(0, v + amount * 0.12));
  s = Math.min(1, Math.max(0, s - amount * 0.04));
  h = (h + (amount > 0 ? -6 : 6) * Math.abs(amount) + 360) % 360;
  return [...hsvToRgb(h, s, v), a];
}

// ---------- document ----------
// doc = { v, name, width, height, fps, loop, palette[], layers[{id,name,visible,opacity}], frames[{id,duration|null,cels[]}] }
// frames[f].cels[l] is a Uint8ClampedArray(width*height*4) for layer l (same order as doc.layers).
// Scenes add (all optional): tilesets[], sprites[], slices[], grid [w,h], and layers of type "tilemap" or "objects"
// whose cels are rendered from their data (see "scenes" below), so compositing and exports treat them like pixel layers.
export function createDoc({ width = 32, height = 32, name = "Untitled", palette = "Pixeter 32", background = null, fps = 8 } = {}) {
  width = clampInt(width, 1, MAX_SIZE); height = clampInt(height, 1, MAX_SIZE);
  const doc = {
    v: VERSION, name, width, height, fps, loop: "loop",
    palette: [...(Array.isArray(palette) ? palette : PALETTES[palette] || PALETTES["Pixeter 32"])],
    layers: [{ id: uid("l"), name: "Layer 1", visible: true, opacity: 1 }],
    frames: [],
  };
  doc.frames.push(newFrame(doc));
  if (background) fillBuffer(doc.frames[0].cels[0], hexToRgba(background));
  return doc;
}
export const blankCel = (doc) => new Uint8ClampedArray(doc.width * doc.height * 4);
export function newFrame(doc) { return { id: uid("f"), duration: null, cels: doc.layers.map(() => blankCel(doc)) }; }
export function cloneDoc(doc) {
  return { ...doc, palette: [...doc.palette], layers: doc.layers.map(cloneLayer), tags: doc.tags ? doc.tags.map((t) => ({ ...t })) : undefined,
    tilesets: doc.tilesets ? doc.tilesets.map((ts) => ({ ...ts, tiles: ts.tiles.map((t) => new Uint8ClampedArray(t)), terrains: (ts.terrains || []).map((t) => ({ ...t, tiles: [...t.tiles] })) })) : undefined,
    sprites: doc.sprites ? doc.sprites.map((s) => ({ ...s, frames: s.frames.map((f) => new Uint8ClampedArray(f)) })) : undefined,
    slices: doc.slices ? doc.slices.map(cloneSlice) : undefined,
    frames: doc.frames.map((f) => ({ ...f, cels: f.cels.map((c) => new Uint8ClampedArray(c)) })) };
}
function cloneLayer(l) {
  const o = { ...l };
  if (l.map) o.map = new Uint16Array(l.map);
  if (l.objects) o.objects = l.objects.map((ob) => ({ ...ob, props: ob.props ? { ...ob.props } : undefined }));
  if (l.parallax) o.parallax = [...l.parallax];
  return o;
}
const cloneSlice = (s) => ({ ...s, pivot: s.pivot ? { ...s.pivot } : undefined, keys: s.keys ? Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, { ...v }])) : undefined });
export const frameDuration = (doc, f) => doc.frames[f].duration || Math.round(1000 / (doc.fps || 8));
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))); }

// ---------- pixel primitives ----------
export function fillBuffer(buf, c) { for (let i = 0; i < buf.length; i += 4) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3]; } }
export function getPx(buf, w, h, x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return null; const i = (y * w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; }
export function setPx(buf, w, h, x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
}
const same = (buf, i, c) => buf[i] === c[0] && buf[i + 1] === c[1] && buf[i + 2] === c[2] && buf[i + 3] === c[3];

export function linePoints(x0, y0, x1, y1) {
  const pts = []; x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}
export function rectPoints(x0, y0, x1, y1, filled) {
  const pts = [], [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++)
    if (filled || x === ax || x === bx || y === ay || y === by) pts.push([x, y]);
  return pts;
}
// Ellipse inscribed in the box (x0,y0)-(x1,y1), pixel-accurate for even and odd sizes.
export function ellipsePoints(x0, y0, x1, y1, filled) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const pts = [];
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    if (!inside(x, y)) continue;
    if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
  }
  return pts;
}
// Flood fill: contiguous (4-way) or global (every pixel of the same colour). Returns changed points.
export function fillPoints(buf, w, h, x, y, contiguous = true, tolerance = 0) {
  const start = getPx(buf, w, h, x, y);
  if (!start) return [];
  const near = (i) => tolerance === 0 ? same(buf, i, start)
    : Math.abs(buf[i] - start[0]) + Math.abs(buf[i + 1] - start[1]) + Math.abs(buf[i + 2] - start[2]) + Math.abs(buf[i + 3] - start[3]) <= tolerance * 4;
  const pts = [];
  if (!contiguous) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (near((yy * w + xx) * 4)) pts.push([xx, yy]);
    return pts;
  }
  const seen = new Uint8Array(w * h), stack = [x | 0, y | 0];
  while (stack.length) {
    const yy = stack.pop(), xx = stack.pop();
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const k = yy * w + xx;
    if (seen[k] || !near(k * 4)) continue;
    seen[k] = 1; pts.push([xx, yy]);
    stack.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1);
  }
  return pts;
}
export function plot(buf, w, h, pts, c, size = 1) {
  for (const [x, y] of pts) {
    if (size <= 1) { setPx(buf, w, h, x, y, c); continue; }
    const o = Math.floor((size - 1) / 2);
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setPx(buf, w, h, x - o + dx, y - o + dy, c);
  }
}
export const isDitherCell = (x, y) => ((x + y) & 1) === 0;

// ---------- transforms on a single cel ----------
export function transformCel(buf, w, h, kind, a = 0, b = 0) {
  const out = new Uint8ClampedArray(buf.length);
  const copy = (sx, sy, dx, dy) => { const s = (sy * w + sx) * 4, d = (dy * w + dx) * 4; out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2]; out[d + 3] = buf[s + 3]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (kind === "flip_h") copy(x, y, w - 1 - x, y);
    else if (kind === "flip_v") copy(x, y, x, h - 1 - y);
    else if (kind === "shift") { const nx = x + a, ny = y + b; if (a || b) copy(x, y, ((nx % w) + w) % w, ((ny % h) + h) % h); else copy(x, y, x, y); }
    else if (kind === "rotate180") copy(x, y, w - 1 - x, h - 1 - y);
    else if (kind === "rotate90" && w === h) copy(x, y, w - 1 - y, x);
    else copy(x, y, x, y);
  }
  return out;
}
export function replaceColor(buf, from, to) {
  let n = 0;
  for (let i = 0; i < buf.length; i += 4) if (same(buf, i, from)) { buf[i] = to[0]; buf[i + 1] = to[1]; buf[i + 2] = to[2]; buf[i + 3] = to[3]; n++; }
  return n;
}
// Add a 1px outline around opaque pixels (outside only).
export function outlineCel(buf, w, h, c) {
  const src = new Uint8ClampedArray(buf);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (src[(y * w + x) * 4 + 3]) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const p = getPx(src, w, h, x + dx, y + dy); return p && p[3] > 0; });
    if (n) setPx(buf, w, h, x, y, c);
  }
}

// ---------- compositing ----------
// rect {x,y,w,h} limits the work to one area of an existing `out` buffer (used for fast live redraws on big canvases).
export function compositeFrame(doc, f, { onlyLayer = null, skipReference = false, rect = null, out = null } = {}) {
  const W = doc.width;
  out = out || new Uint8ClampedArray(W * doc.height * 4);
  if (rect) for (let y = rect.y; y < rect.y + rect.h; y++) out.fill(0, (y * W + rect.x) * 4, (y * W + rect.x + rect.w) * 4);
  const frame = doc.frames[f];
  doc.layers.forEach((layer, li) => {
    if (onlyLayer != null ? li !== onlyLayer : !layer.visible || (skipReference && layer.reference)) return;
    blendInto(out, frame.cels[li], layer.opacity ?? 1, layer.blend || "normal", rect, W);
  });
  return out;
}
// Separable blend modes (W3C compositing). Values are 0..1.
const BLEND = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: Math.min, lighten: Math.max,
  colordodge: (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  colorburn: (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  hardlight: (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  softlight: (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)),
  difference: (b, s) => Math.abs(b - s), exclusion: (b, s) => b + s - 2 * b * s,
  add: (b, s) => Math.min(1, b + s), subtract: (b, s) => Math.max(0, b - s), divide: (b, s) => (s <= 0 ? 1 : Math.min(1, b / s)),
};
export const BLEND_MODES = ["normal", ...Object.keys(BLEND)];
export function blendInto(dst, src, opacity = 1, mode = "normal", rect = null, W = 0) {
  const fn = BLEND[mode];
  if (!rect) return blendRange(dst, src, opacity, fn, 0, dst.length);
  for (let y = rect.y; y < rect.y + rect.h; y++) blendRange(dst, src, opacity, fn, (y * W + rect.x) * 4, (y * W + rect.x + rect.w) * 4);
}
function blendRange(dst, src, opacity, fn, from, to) {
  const fast = !fn && opacity >= 1;
  for (let i = from; i < to; i += 4) {
    const a8 = src[i + 3];
    if (!a8) continue;
    if (fast && a8 === 255) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = 255; continue; }
    const sa = (a8 / 255) * opacity;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255, oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      let cs = src[i + k] / 255;
      if (fn && da > 0) { const cb = dst[i + k] / 255; cs = (1 - da) * cs + da * fn(cb, cs); }
      dst[i + k] = (cs * 255 * sa + dst[i + k] * da * (1 - sa)) / oa;
    }
    dst[i + 3] = oa * 255;
  }
}
export function scaleBuffer(buf, w, h, s) {
  if (s === 1) return buf;
  const W = w * s, out = new Uint8ClampedArray(W * h * s * 4);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < W; x++) {
    const si = (((y / s) | 0) * w + ((x / s) | 0)) * 4, di = (y * W + x) * 4;
    out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
  }
  return out;
}
// Lay frames out in a grid. Returns { pixels, width, height, cols, rows, frames:[{x,y,w,h,duration}] }.
export function spritesheet(doc, { cols = 0, scale = 1, padding = 0 } = {}) {
  const n = doc.frames.length;
  cols = cols || Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols), fw = doc.width * scale, fh = doc.height * scale;
  const W = cols * fw + (cols - 1) * padding, H = rows * fh + (rows - 1) * padding;
  const out = new Uint8ClampedArray(W * H * 4), meta = [];
  for (let f = 0; f < n; f++) {
    const img = scaleBuffer(compositeFrame(doc, f, { skipReference: true }), doc.width, doc.height, scale);
    const ox = (f % cols) * (fw + padding), oy = Math.floor(f / cols) * (fh + padding);
    for (let y = 0; y < fh; y++) out.set(img.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * W + ox) * 4);
    meta.push({ x: ox, y: oy, w: fw, h: fh, duration: frameDuration(doc, f) });
  }
  return { pixels: out, width: W, height: H, cols, rows, frames: meta };
}
export function countColors(doc) {
  const set = new Set();
  for (const fr of doc.frames) for (const cel of fr.cels) for (let i = 0; i < cel.length; i += 4) if (cel[i + 3]) set.add((cel[i] << 16) | (cel[i + 1] << 8) | cel[i + 2]);
  return set.size;
}
export function usedColors(doc, limit = 256) {
  const m = new Map();
  for (const fr of doc.frames) for (const cel of fr.cels) for (let i = 0; i < cel.length; i += 4) {
    if (!cel[i + 3]) continue;
    const k = rgbaToHex([cel[i], cel[i + 1], cel[i + 2], 255]);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
}

// ---------- ASCII sprite rows (great for Claude) ----------
// rows: ["..rr..", ".rRRr."], key: { r: "#aa0000", R: "#ff3030" }. "." or " " = skip, "_" = erase.
export function drawRows(buf, w, h, x0, y0, rows, key = {}) {
  let n = 0;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === "." || ch === " ") return;
    const c = ch === "_" ? [0, 0, 0, 0] : key[ch] != null ? hexToRgba(key[ch]) : null;
    if (!c) throw new Error(`Character "${ch}" in rows has no colour in key`);
    setPx(buf, w, h, x0 + x, y0 + y, c); n++;
  }));
  return n;
}

// ---------- high-level ops (shared by the editor and MCP) ----------
// Each op: { op, ...args }. Coordinates are pixels, colours are hex strings.
export function applyDrawOps(doc, frameIndex, layerIndex, ops) {
  const w = doc.width, h = doc.height;
  const fr = doc.frames[frameIndex];
  if (!fr) throw new Error(`No frame ${frameIndex} (have ${doc.frames.length})`);
  const buf = fr.cels[layerIndex];
  if (!buf) throw new Error(`No layer ${layerIndex} (have ${doc.layers.length})`);
  let changed = 0;
  const col = (o) => hexToRgba(o.color ?? "#000000");
  for (const o of ops) {
    switch (o.op) {
      case "pixel": setPx(buf, w, h, o.x, o.y, col(o)); changed++; break;
      case "pixels": for (const p of o.points || []) { setPx(buf, w, h, p[0], p[1], p[2] ? hexToRgba(p[2]) : col(o)); changed++; } break;
      case "line": { const pts = linePoints(o.x1 ?? o.x, o.y1 ?? o.y, o.x2, o.y2); plot(buf, w, h, pts, col(o), o.size || 1); changed += pts.length; break; }
      case "polyline": { const ps = o.points || []; for (let i = 1; i < ps.length; i++) { const pts = linePoints(ps[i - 1][0], ps[i - 1][1], ps[i][0], ps[i][1]); plot(buf, w, h, pts, col(o), o.size || 1); changed += pts.length; } break; }
      case "rect": { const pts = rectPoints(o.x, o.y, o.x + (o.w ?? 1) - 1, o.y + (o.h ?? 1) - 1, o.filled !== false); plot(buf, w, h, pts, col(o)); changed += pts.length; break; }
      case "ellipse": { const pts = ellipsePoints(o.x, o.y, o.x + (o.w ?? 1) - 1, o.y + (o.h ?? 1) - 1, o.filled !== false); plot(buf, w, h, pts, col(o)); changed += pts.length; break; }
      case "circle": { const r = o.r ?? 1; const pts = ellipsePoints(o.cx - r, o.cy - r, o.cx + r, o.cy + r, o.filled !== false); plot(buf, w, h, pts, col(o)); changed += pts.length; break; }
      case "fill": { const pts = fillPoints(buf, w, h, o.x, o.y, o.contiguous !== false); plot(buf, w, h, pts, col(o)); changed += pts.length; break; }
      case "dither": { const pts = rectPoints(o.x, o.y, o.x + (o.w ?? 1) - 1, o.y + (o.h ?? 1) - 1, true).filter(([x, y]) => isDitherCell(x, y) !== !!o.invert); plot(buf, w, h, pts, col(o)); changed += pts.length; break; }
      case "erase": { const pts = o.w ? rectPoints(o.x, o.y, o.x + o.w - 1, o.y + (o.h ?? 1) - 1, true) : [[o.x, o.y]]; plot(buf, w, h, pts, [0, 0, 0, 0]); changed += pts.length; break; }
      case "rows": changed += drawRows(buf, w, h, o.x || 0, o.y || 0, o.rows || [], o.key || {}); break;
      case "replace_color": changed += replaceColor(buf, hexToRgba(o.from), hexToRgba(o.to)); break;
      case "outline": outlineCel(buf, w, h, col(o)); changed++; break;
      case "shade": { const pts = o.w ? rectPoints(o.x, o.y, o.x + o.w - 1, o.y + (o.h ?? 1) - 1, true) : [[o.x, o.y]]; for (const [x, y] of pts) { const p = getPx(buf, w, h, x, y); if (p) setPx(buf, w, h, x, y, shade(p, o.amount ?? 1)); } changed += pts.length; break; }
      case "clear": buf.fill(0); changed++; break;
      default: throw new Error(`Unknown draw op "${o.op}"`);
    }
  }
  return changed;
}
export function transformFrames(doc, frames, layers, kind, a, b) {
  layers = layers.filter((l) => !isDerived(doc.layers[l]));
  for (const f of frames) for (const l of layers) doc.frames[f].cels[l] = transformCel(doc.frames[f].cels[l], doc.width, doc.height, kind, a, b);
}
export function resizeDoc(doc, width, height, anchor = "center") {
  width = clampInt(width, 1, MAX_SIZE); height = clampInt(height, 1, MAX_SIZE);
  // anchor: "center", "topleft", or an explicit pixel offset {x, y} for the old canvas (negative crops from the left/top)
  const ox = typeof anchor === "object" ? Math.round(anchor.x) : anchor === "center" ? Math.floor((width - doc.width) / 2) : 0;
  const oy = typeof anchor === "object" ? Math.round(anchor.y) : anchor === "center" ? Math.floor((height - doc.height) / 2) : 0;
  for (const fr of doc.frames) fr.cels = fr.cels.map((cel) => {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const s = (y * doc.width + x) * 4, d = (ny * width + nx) * 4;
      out[d] = cel[s]; out[d + 1] = cel[s + 1]; out[d + 2] = cel[s + 2]; out[d + 3] = cel[s + 3];
    }
    return out;
  });
  doc.width = width; doc.height = height;
  // scene data moves with the pixels
  for (const l of doc.layers) {
    if (l.type === "tilemap") { const ts = getTileset(doc, l.tileset); ensureMap(doc, l, ts, Math.floor(ox / ts.tw), Math.floor(oy / ts.th)); }
    if (l.objects) for (const o of l.objects) { o.x += ox; o.y += oy; }
  }
  for (const s of doc.slices || []) { s.x += ox; s.y += oy; for (const k of Object.values(s.keys || {})) { k.x += ox; k.y += oy; } }
  renderDerived(doc);
}
export function addLayer(doc, name, at = doc.layers.length, props = {}) {
  doc.layers.splice(at, 0, { id: uid("l"), name: name || `Layer ${doc.layers.length + 1}`, visible: true, opacity: 1, ...props });
  for (const fr of doc.frames) fr.cels.splice(at, 0, blankCel(doc));
  return at;
}
export function deleteLayer(doc, i) {
  if (doc.layers.length <= 1) throw new Error("Can't delete the only layer");
  doc.layers.splice(i, 1);
  for (const fr of doc.frames) fr.cels.splice(i, 1);
}
export function moveLayer(doc, from, to) {
  to = Math.max(0, Math.min(doc.layers.length - 1, to));
  const [l] = doc.layers.splice(from, 1); doc.layers.splice(to, 0, l);
  for (const fr of doc.frames) { const [c] = fr.cels.splice(from, 1); fr.cels.splice(to, 0, c); }
  return to;
}
export function mergeDown(doc, i) {
  if (i <= 0) throw new Error("Nothing below to merge into");
  if (isDerived(doc.layers[i - 1])) throw new Error(`Can't merge into a ${doc.layers[i - 1].type} layer`);
  for (const fr of doc.frames) {
    const below = fr.cels[i - 1];
    blendInto(below, fr.cels[i], doc.layers[i].opacity ?? 1);
  }
  doc.layers.splice(i, 1);
  for (const fr of doc.frames) fr.cels.splice(i, 1);
}
export function addFrame(doc, at = doc.frames.length, copyOf = null) {
  const fr = copyOf != null ? { id: uid("f"), duration: doc.frames[copyOf].duration, cels: doc.frames[copyOf].cels.map((c) => new Uint8ClampedArray(c)) } : newFrame(doc);
  doc.frames.splice(at, 0, fr);
  for (const t of doc.tags || []) { if (t.from >= at) t.from++; if (t.to >= at) t.to++; }
  if (copyOf == null) doc.layers.forEach((l, li) => isDerived(l) && renderLayer(doc, li, [at]));
  return at;
}
export function deleteFrame(doc, i) {
  if (doc.frames.length <= 1) throw new Error("Can't delete the only frame");
  doc.frames.splice(i, 1);
  if (doc.tags) doc.tags = doc.tags.filter((t) => { if (t.from > i) t.from--; if (t.to >= i) t.to--; return t.to >= t.from; });
}
export function moveFrame(doc, from, to) {
  to = Math.max(0, Math.min(doc.frames.length - 1, to));
  const [f] = doc.frames.splice(from, 1); doc.frames.splice(to, 0, f);
  return to;
}

// ---------- serialisation (.pixeter = JSON, cels as base64 RGBA) ----------
export function b64encode(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  if (typeof Buffer !== "undefined") return new Uint8ClampedArray(Buffer.from(str, "base64"));
  const s = atob(str), out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function serialize(doc) {
  const out = { ...doc, app: "pixeter",
    layers: doc.layers.map((l) => (l.map ? { ...l, map: Array.from(l.map) } : l)),
    // tilemap and object layers are rebuilt from their data on load, so their pixels aren't stored
    frames: doc.frames.map((f) => ({ ...f, cels: f.cels.map((c, i) => (isDerived(doc.layers[i]) ? "" : b64encode(c))) })) };
  if (doc.tilesets) out.tilesets = doc.tilesets.map((ts) => ({ ...ts, tiles: ts.tiles.map(b64encode) }));
  if (doc.sprites) out.sprites = doc.sprites.map((s) => ({ ...s, frames: s.frames.map(b64encode) }));
  return out;
}
export function deserialize(data) {
  if (typeof data === "string") data = JSON.parse(data);
  if (!data || !Array.isArray(data.frames) || !data.width) throw new Error("Not a Pixeter document");
  const doc = { v: VERSION, name: data.name || "Untitled", width: data.width, height: data.height, fps: data.fps || 8, loop: data.loop || "loop",
    palette: data.palette || [...PALETTES["Pixeter 32"]], layers: data.layers.map(readLayer),
    frames: data.frames.map((f) => ({ id: f.id || uid("f"), duration: f.duration || null, cels: f.cels.map((c) => (typeof c === "string" ? b64decode(c) : new Uint8ClampedArray(c))) })) };
  if (Array.isArray(data.tags)) doc.tags = data.tags.filter((t) => t && Number.isInteger(t.from) && Number.isInteger(t.to)).map((t) => ({ name: String(t.name || "Tag"), from: t.from, to: t.to, color: t.color || "#7c5cff", dir: t.dir || "forward" }));
  if (data.sub > 1 && data.width % data.sub === 0 && data.height % data.sub === 0) doc.sub = data.sub;
  if (Array.isArray(data.grid) && data.grid[0] > 0 && data.grid[1] > 0) doc.grid = [data.grid[0], data.grid[1]];
  const dec = (c) => (typeof c === "string" ? b64decode(c) : new Uint8ClampedArray(c));
  if (Array.isArray(data.tilesets)) doc.tilesets = data.tilesets.map((ts) => ({ id: ts.id || uid("t"), name: ts.name || "Tileset", tw: ts.tw, th: ts.th,
    tiles: (ts.tiles || []).map(dec).map((t) => (t.length === ts.tw * ts.th * 4 ? t : new Uint8ClampedArray(ts.tw * ts.th * 4))),
    terrains: (ts.terrains || []).map((t) => ({ name: t.name || "Terrain", tiles: (t.tiles || []).slice(0, 16) })) }));
  if (Array.isArray(data.sprites)) doc.sprites = data.sprites.map((s) => ({ id: s.id || uid("s"), name: s.name || "Sprite", w: s.w, h: s.h, fps: s.fps || null,
    frames: (s.frames || []).map(dec).map((f) => (f.length === s.w * s.h * 4 ? f : new Uint8ClampedArray(s.w * s.h * 4))) }));
  if (Array.isArray(data.slices)) doc.slices = data.slices.map((s) => cloneSlice({ ...s, id: s.id || uid("sl"), name: s.name || "Slice", kind: s.kind || "slice", color: s.color || "#2fb8e0" }));
  const n = doc.width * doc.height * 4;
  for (const f of doc.frames) {
    f.cels = f.cels.map((c) => (c.length === n ? c : new Uint8ClampedArray(n)));
    while (f.cels.length < doc.layers.length) f.cels.push(new Uint8ClampedArray(n));
  }
  doc.layers.forEach((l) => { if (l.type === "tilemap" && !(doc.tilesets || []).some((t) => t.id === l.tileset)) { delete l.type; delete l.map; delete l.tileset; } });
  renderDerived(doc);
  return doc;
}
function readLayer(l) {
  const o = { id: l.id || uid("l"), name: l.name, visible: l.visible !== false, opacity: l.opacity ?? 1, blend: l.blend || "normal", locked: !!l.locked, reference: !!l.reference };
  if (l.background) o.background = true;
  if (Array.isArray(l.parallax)) o.parallax = [+l.parallax[0] || 0, +l.parallax[1] || 0];
  if (l.type === "tilemap") Object.assign(o, { type: "tilemap", tileset: l.tileset, cols: l.cols, map: Uint16Array.from(l.map || []) });
  if (l.type === "objects") Object.assign(o, { type: "objects", objects: (l.objects || []).map((ob) => ({ id: ob.id || uid("o"), sprite: ob.sprite, x: ob.x | 0, y: ob.y | 0, flipX: !!ob.flipX, name: ob.name, props: ob.props })) });
  return o;
}
// Build a document from flat RGBA frames (used by PNG / spritesheet import).
export function docFromImages(images, width, height, name = "Imported") {
  const doc = createDoc({ width, height, name });
  doc.frames = images.map((px) => ({ id: uid("f"), duration: null, cels: [new Uint8ClampedArray(px)] }));
  const used = usedColors(doc, 64);
  if (used.length) doc.palette = used;
  return doc;
}
export function sliceSheet(pixels, W, H, fw, fh) {
  const out = [];
  for (let oy = 0; oy + fh <= H; oy += fh) for (let ox = 0; ox + fw <= W; ox += fw) {
    const cel = new Uint8ClampedArray(fw * fh * 4);
    for (let y = 0; y < fh; y++) cel.set(pixels.subarray(((oy + y) * W + ox) * 4, ((oy + y) * W + ox + fw) * 4), y * fw * 4);
    if (cel.some((v, i) => i % 4 === 3 && v)) out.push(cel);
  }
  return out;
}

// ---------- scenes: tilesets, tilemap layers, sprites, object layers, slices ----------
// doc.tilesets = [{ id, name, tw, th, tiles: [Uint8ClampedArray(tw*th*4)], terrains: [{ name, tiles: [16 tile numbers] }] }]
// A tilemap layer is { type: "tilemap", tileset: id, cols, map: Uint16Array(cols*rows) }: 0 = empty, n = tileset.tiles[n-1].
// doc.sprites = [{ id, name, w, h, frames: [Uint8ClampedArray(w*h*4)], fps }] is a library of (animated) sprites, and an
// object layer is { type: "objects", objects: [{ id, sprite, x, y, flipX, name, props }] }. Scene frame f shows sprite frame f % n.
// Both kinds are "derived": their cels are rendered from that data in every frame by renderLayer().
// doc.slices = [{ id, name, kind, color, x, y, w, h, pivot?, keys? }] are named rectangles (sprite regions, hitboxes, triggers,
// spawn points). keys maps a frame id to a rect for that frame onward, for hitboxes that change during an animation.
export const isDerived = (l) => !!l && (l.type === "tilemap" || l.type === "objects");
export const SLICE_KINDS = ["slice", "hitbox", "hurtbox", "trigger", "spawn", "solid"];
const SLICE_COLORS = { slice: "#2fb8e0", hitbox: "#e04a4a", hurtbox: "#f0b13a", trigger: "#5cbf4a", spawn: "#ff6bb5", solid: "#9badb7" };
const byName = (list, id, what) => {
  const k = String(id).toLowerCase(), it = (list || []).find((t) => t.id === id) || (list || []).find((t) => t.name.toLowerCase() === k);
  if (!it) throw new Error(`No ${what} "${id}"${list && list.length ? ` (have: ${list.map((t) => t.name).join(", ")})` : ""}`);
  return it;
};
const isEmptyPx = (px) => { for (let i = 3; i < px.length; i += 4) if (px[i]) return false; return true; };
const samePx = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
// Copy a w*h region out of a W*H buffer (transparent pixels are normalised to 0,0,0,0). `base` keeps pixels outside the buffer.
export function cutRegion(buf, W, H, x0, y0, w, h, base = null) {
  const out = base ? new Uint8ClampedArray(base) : new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const s = (sy * W + sx) * 4, d = (y * w + x) * 4;
    if (buf[s + 3]) out.set(buf.subarray(s, s + 4), d); else out.fill(0, d, d + 4);
  }
  return out;
}
// Draw src (w*h) into dst at ox,oy. Tiles are copied; objects are alpha-blended over what's there.
function blit(dst, W, H, src, w, h, ox, oy, flipX = false, over = false) {
  for (let y = 0; y < h; y++) {
    const dy = oy + y; if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < w; x++) {
      const dx = ox + x; if (dx < 0 || dx >= W) continue;
      const s = (y * w + (flipX ? w - 1 - x : x)) * 4, a = src[s + 3]; if (!a) continue;
      const d = (dy * W + dx) * 4;
      if (!over || a === 255 || !dst[d + 3]) { dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = a; continue; }
      const sa = a / 255, da = dst[d + 3] / 255, oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) dst[d + k] = (src[s + k] * sa + dst[d + k] * da * (1 - sa)) / oa;
      dst[d + 3] = oa * 255;
    }
  }
}

// ----- tilesets -----
export const getTileset = (doc, id) => byName(doc.tilesets, id, "tileset");
export function addTileset(doc, { name, tw = 16, th = 16 } = {}) {
  const ts = { id: uid("t"), name: name || `Tileset ${(doc.tilesets || []).length + 1}`, tw: clampInt(tw, 1, 256), th: clampInt(th, 1, 256), tiles: [], terrains: [] };
  (doc.tilesets ||= []).push(ts);
  return ts;
}
export const mapSize = (doc, ts) => ({ cols: Math.ceil(doc.width / ts.tw), rows: Math.ceil(doc.height / ts.th) });
export function findTile(ts, px) { for (let k = 0; k < ts.tiles.length; k++) if (samePx(ts.tiles[k], px)) return k + 1; return 0; }
// Add a tile and return its number (1-based). dedupe reuses an identical existing tile.
export function addTile(ts, px, dedupe = false) {
  if (px.length !== ts.tw * ts.th * 4) throw new Error(`A tile in "${ts.name}" is ${ts.tw}x${ts.th}`);
  if (dedupe) { const i = findTile(ts, px); if (i) return i; }
  ts.tiles.push(new Uint8ClampedArray(px));
  return ts.tiles.length;
}
// Slice an image into tiles, row by row. Empty tiles are skipped and duplicates reused. Returns the tile numbers.
export function tilesFromImage(ts, pixels, W, H, { dedupe = true, keepEmpty = false } = {}) {
  const out = [];
  for (let y = 0; y + ts.th <= H; y += ts.th) for (let x = 0; x + ts.tw <= W; x += ts.tw) {
    const t = cutRegion(pixels, W, H, x, y, ts.tw, ts.th);
    if (!keepEmpty && isEmptyPx(t)) continue;
    out.push(addTile(ts, t, dedupe));
  }
  return out;
}
// The tileset as one image: `cols` tiles per row (tile n sits at ((n-1) % cols, floor((n-1) / cols))).
export function tilesetImage(ts, cols = 0) {
  const n = Math.max(1, ts.tiles.length); cols = cols || Math.min(n, 16);
  const rows = Math.ceil(n / cols), W = cols * ts.tw, H = rows * ts.th, px = new Uint8ClampedArray(W * H * 4);
  ts.tiles.forEach((t, i) => blit(px, W, H, t, ts.tw, ts.th, (i % cols) * ts.tw, Math.floor(i / cols) * ts.th));
  return { pixels: px, width: W, height: H, cols, rows };
}

// ----- tilemap layers -----
// Keep a layer's map sized to the canvas. dc/dr shift the existing cells (when the canvas grows on the left/top).
function ensureMap(doc, l, ts, dc = 0, dr = 0) {
  const { cols, rows } = mapSize(doc, ts);
  if (l.map && l.cols === cols && l.map.length === cols * rows && !dc && !dr) return { cols, rows };
  const old = l.map || new Uint16Array(0), oc = l.cols || cols, orows = oc ? Math.floor(old.length / oc) : 0, map = new Uint16Array(cols * rows);
  for (let r = 0; r < orows; r++) for (let c = 0; c < oc; c++) { const nc = c + dc, nr = r + dr; if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) map[nr * cols + nc] = old[r * oc + c]; }
  l.map = map; l.cols = cols;
  return { cols, rows };
}
export function addTilemapLayer(doc, tileset, name, at = doc.layers.length) {
  const ts = getTileset(doc, tileset), { cols, rows } = mapSize(doc, ts);
  addLayer(doc, name || ts.name, at, { type: "tilemap", tileset: ts.id, cols, map: new Uint16Array(cols * rows) });
  return at;
}
export function layerTileset(doc, li) {
  const l = doc.layers[li];
  if (!l || l.type !== "tilemap") throw new Error(`Layer ${li} "${l ? l.name : "?"}" is not a tilemap layer`);
  const ts = getTileset(doc, l.tileset); ensureMap(doc, l, ts);
  return ts;
}
export function getTile(doc, li, c, r) { const l = doc.layers[li], ts = layerTileset(doc, li); return c < 0 || r < 0 || c >= l.cols || r * l.cols >= l.map.length ? -1 : l.map[r * l.cols + c]; }
// Set cells: cells = [[col, row, tile]]. Tile numbers past the end of the tileset are refused.
export function setTiles(doc, li, cells, render = true) {
  const l = doc.layers[li], ts = layerTileset(doc, li), rows = l.map.length / l.cols;
  let n = 0;
  for (const [c, r, t] of cells) {
    if (t < 0 || t > ts.tiles.length) throw new Error(`Tile ${t} doesn't exist (tileset "${ts.name}" has ${ts.tiles.length} tiles, 0 = empty)`);
    if (c < 0 || r < 0 || c >= l.cols || r >= rows) continue;
    l.map[r * l.cols + c] = t; n++;
  }
  if (render) renderLayer(doc, li);
  return n;
}
export function fillTiles(doc, li, c0, r0, w, h, t) { const cells = []; for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) cells.push([c, r, t]); return setTiles(doc, li, cells); }
// Flood fill a tile across connected cells that hold the same tile.
export function floodTiles(doc, li, c, r, t) {
  const l = doc.layers[li]; layerTileset(doc, li);
  const cols = l.cols, rows = l.map.length / cols, from = l.map[r * cols + c], cells = [], seen = new Uint8Array(l.map.length), st = [[c, r]];
  if (c < 0 || r < 0 || c >= cols || r >= rows || from === t) return 0;
  while (st.length) { const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= cols || y >= rows) continue; const k = y * cols + x; if (seen[k] || l.map[k] !== from) continue; seen[k] = 1; cells.push([x, y, t]); st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
  return setTiles(doc, li, cells);
}
// Re-render every layer that uses this tileset (after its tiles change).
export function renderTilesetUsers(doc, tsId) { doc.layers.forEach((l, i) => { if (l.type === "tilemap" && l.tileset === tsId) renderLayer(doc, i); }); }
// After pixels were painted straight onto a tilemap layer's cel: write the changes back into the tiles (Aseprite-style
// tile editing). Edited cells update their tile everywhere it's used, painted empty cells become new tiles, and
// fully erased cells become empty. Returns { changed, added }.
export function syncTilemapFromCel(doc, li, f) {
  const l = doc.layers[li], ts = layerTileset(doc, li), cel = doc.frames[f].cels[li], W = doc.width, H = doc.height, rows = l.map.length / l.cols;
  let changed = 0, added = 0;
  const orig = ts.tiles.slice(); // compare against the tiles as they were, so untouched copies of an edited tile don't undo the edit
  for (let r = 0; r < rows; r++) for (let c = 0; c < l.cols; c++) {
    const k = r * l.cols + c, t = l.map[k], cur = t ? orig[t - 1] : null;
    const px = cutRegion(cel, W, H, c * ts.tw, r * ts.th, ts.tw, ts.th, cur);
    if (cur ? samePx(px, cur) : isEmptyPx(px)) continue;
    changed++;
    if (isEmptyPx(px)) l.map[k] = 0;
    else if (t) ts.tiles[t - 1] = px;
    else { const n0 = ts.tiles.length; l.map[k] = addTile(ts, px, true); if (ts.tiles.length > n0) added++; }
  }
  if (changed) renderTilesetUsers(doc, ts.id);
  return { changed, added };
}
// Turn a pixel layer into a tilemap layer: cut frame 0 into tiles (duplicates merged) and build the map.
export function layerToTilemap(doc, li, { tw = 16, th = 16, tileset = null, name = null } = {}) {
  const l = doc.layers[li];
  if (isDerived(l)) throw new Error(`Layer "${l.name}" is already a ${l.type} layer`);
  const ts = tileset != null ? getTileset(doc, tileset) : addTileset(doc, { name: name || `${l.name} tiles`, tw, th });
  const { cols, rows } = mapSize(doc, ts), map = new Uint16Array(cols * rows), cel = doc.frames[0].cels[li];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const px = cutRegion(cel, doc.width, doc.height, c * ts.tw, r * ts.th, ts.tw, ts.th); if (!isEmptyPx(px)) map[r * cols + c] = addTile(ts, px, true); }
  Object.assign(l, { type: "tilemap", tileset: ts.id, cols, map });
  renderLayer(doc, li);
  return ts;
}

// ----- terrains (autotiling) -----
// A terrain is 16 tiles picked by which neighbours are the same terrain: N=1, E=2, S=4, W=8 (tiles[15] = surrounded).
// Painting a terrain cell re-picks the tile of that cell and its neighbours, so edges and corners appear by themselves.
export function addTerrain(ts, name, tiles) {
  if (!Array.isArray(tiles) || tiles.length !== 16) throw new Error("A terrain needs 16 tile numbers (index = N1+E2+S4+W8)");
  for (const t of tiles) if (!(t >= 1 && t <= ts.tiles.length)) throw new Error(`Tile ${t} doesn't exist in "${ts.name}"`);
  (ts.terrains ||= []).push({ name: name || `Terrain ${ts.terrains.length + 1}`, tiles: [...tiles] });
  return ts.terrains.length - 1;
}
export function terrainIndex(ts, id) {
  if (typeof id === "number" && ts.terrains[id]) return id;
  const i = (ts.terrains || []).findIndex((t) => t.name.toLowerCase() === String(id).toLowerCase());
  if (i < 0) throw new Error(`No terrain "${id}" in "${ts.name}"${ts.terrains.length ? ` (have: ${ts.terrains.map((t) => t.name).join(", ")})` : ""}`);
  return i;
}
const terrainOf = (ts, t) => (t ? ts.terrains.findIndex((tr) => tr.tiles.includes(t)) : -1);
// Make the 16 tiles of a terrain from one fill tile: open sides get a border (a colour, or a darker shade of the fill)
// and outer corners are rounded off. fill is a tile's pixels or a colour.
export function makeAutotile(ts, { name, fill, border = null, thickness = 1, round = true, highlight = true } = {}) {
  const tw = ts.tw, th = ts.th, t = Math.max(1, Math.min(thickness, Math.floor(Math.min(tw, th) / 3)));
  const base = fill instanceof Uint8ClampedArray ? fill : (() => { const b = new Uint8ClampedArray(tw * th * 4); fillBuffer(b, hexToRgba(fill || "#6abe30")); return b; })();
  const bc = border ? hexToRgba(border) : null, tiles = [];
  for (let m = 0; m < 16; m++) {
    const px = new Uint8ClampedArray(base), N = !(m & 1), E = !(m & 2), S = !(m & 4), Wd = !(m & 8);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 4; if (!px[i + 3]) continue;
      const edge = (N && y < t) || (S && y >= th - t) || (Wd && x < t) || (E && x >= tw - t);
      const corner = round && ((N && Wd && x + y < t) || (N && E && tw - 1 - x + y < t) || (S && Wd && x + th - 1 - y < t) || (S && E && tw - 1 - x + th - 1 - y < t));
      if (corner) { px.fill(0, i, i + 4); continue; }
      if (edge) px.set(bc || shade([px[i], px[i + 1], px[i + 2], px[i + 3]], -2), i);
      else if (highlight && N && y === t) px.set(shade([px[i], px[i + 1], px[i + 2], px[i + 3]], 1), i);
    }
    tiles.push(addTile(ts, px));
  }
  return addTerrain(ts, name, tiles);
}
// Paint (or erase) terrain on cells = [[col,row]], then re-pick tiles around them. Cells off the map count as the same terrain.
export function paintTerrain(doc, li, cells, terrain, { erase = false, render = true } = {}) {
  const l = doc.layers[li], ts = layerTileset(doc, li), ti = terrainIndex(ts, terrain), cols = l.cols, rows = l.map.length / cols, touched = new Set();
  for (const [c, r] of cells) {
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    l.map[r * cols + c] = erase ? 0 : ts.terrains[ti].tiles[15];
    for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c + dc, y = r + dr; if (x >= 0 && y >= 0 && x < cols && y < rows) touched.add(y * cols + x); }
  }
  retile(doc, li, touched);
  if (render) renderLayer(doc, li);
  return touched.size;
}
// Re-pick terrain tiles (all cells, or a Set of cell indexes).
export function retile(doc, li, only = null) {
  const l = doc.layers[li], ts = layerTileset(doc, li), cols = l.cols, rows = l.map.length / cols;
  if (!ts.terrains.length) return;
  const terr = Int16Array.from(l.map, (t) => terrainOf(ts, t));
  const same = (c, r, ti) => c < 0 || r < 0 || c >= cols || r >= rows || terr[r * cols + c] === ti;
  for (const k of only || terr.keys()) {
    const ti = terr[k]; if (ti < 0) continue;
    const c = k % cols, r = (k / cols) | 0;
    l.map[k] = ts.terrains[ti].tiles[(same(c, r - 1, ti) ? 1 : 0) | (same(c + 1, r, ti) ? 2 : 0) | (same(c, r + 1, ti) ? 4 : 0) | (same(c - 1, r, ti) ? 8 : 0)];
  }
}
// ASCII tile map: rows = ["GGGG..", "GWWG.."], key = { G: 3, W: "water" } where a number is a tile and a string is a
// terrain name (auto-tiled). "." or " " = leave, "_" = empty. One character per cell, starting at col,row.
export function paintTileRows(doc, li, col, row, rows, key = {}) {
  const ts = layerTileset(doc, li), cells = [], terr = new Map(), erase = [];
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    if (ch === "." || ch === " ") return;
    const c = col + x, r = row + y;
    if (ch === "_") { cells.push([c, r, 0]); erase.push([c, r]); return; }
    const v = key[ch];
    if (v == null) throw new Error(`Character "${ch}" in rows has no tile or terrain in key`);
    if (typeof v === "number") cells.push([c, r, v]);
    else { const ti = terrainIndex(ts, v); if (!terr.has(ti)) terr.set(ti, []); terr.get(ti).push([c, r]); }
  }));
  let n = setTiles(doc, li, cells, false);
  for (const [ti, cs] of terr) { paintTerrain(doc, li, cs, ti, { render: false }); n += cs.length; }
  if (erase.length) retile(doc, li);
  renderLayer(doc, li);
  return n;
}

// ----- sprites + object layers -----
export const getSprite = (doc, id) => byName(doc.sprites, id, "sprite");
export function addSprite(doc, { name, w, h, frames = [], fps = null }) {
  w = clampInt(w, 1, MAX_SIZE); h = clampInt(h, 1, MAX_SIZE);
  const fr = (frames.length ? frames : [new Uint8ClampedArray(w * h * 4)]).map((f) => { if (f.length !== w * h * 4) throw new Error(`Sprite frames must be ${w}x${h}`); return new Uint8ClampedArray(f); });
  const s = { id: uid("s"), name: name || `Sprite ${(doc.sprites || []).length + 1}`, w, h, frames: fr, fps };
  (doc.sprites ||= []).push(s);
  return s;
}
// A sprite from another document (every frame, flattened) or from an area of this one.
export function spriteFromDoc(doc, src, name) { return addSprite(doc, { name: name || src.name, w: src.width, h: src.height, fps: src.fps, frames: src.frames.map((_, f) => compositeFrame(src, f, { skipReference: true })) }); }
export function spriteFromRegion(doc, { x, y, w, h, frames = null, layer = null, name, trim = false }) {
  const fs = frames || [0];
  let px = fs.map((f) => cutRegion(layer == null ? compositeFrame(doc, f, { skipReference: true }) : doc.frames[f].cels[layer], doc.width, doc.height, x, y, w, h));
  if (trim) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (const p of px) for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (p[(yy * w + xx) * 4 + 3]) { x0 = Math.min(x0, xx); y0 = Math.min(y0, yy); x1 = Math.max(x1, xx); y1 = Math.max(y1, yy); }
    if (x1 >= 0) { px = px.map((p) => cutRegion(p, w, h, x0, y0, x1 - x0 + 1, y1 - y0 + 1)); w = x1 - x0 + 1; h = y1 - y0 + 1; }
  }
  return addSprite(doc, { name, w, h, frames: px, fps: doc.fps });
}
export function removeSprite(doc, id) {
  const s = getSprite(doc, id);
  doc.sprites = doc.sprites.filter((x) => x !== s);
  doc.layers.forEach((l, i) => { if (l.objects) { l.objects = l.objects.filter((o) => o.sprite !== s.id); renderLayer(doc, i); } });
}
export function addObjectLayer(doc, name, at = doc.layers.length) { addLayer(doc, name || "Objects", at, { type: "objects", objects: [] }); return at; }
const objLayer = (doc, li) => { const l = doc.layers[li]; if (!l || l.type !== "objects") throw new Error(`Layer ${li} "${l ? l.name : "?"}" is not an object layer`); return l; };
export function addObject(doc, li, { sprite, x = 0, y = 0, flipX = false, name, props } = {}) {
  const l = objLayer(doc, li), s = getSprite(doc, sprite);
  const o = { id: uid("o"), sprite: s.id, x: Math.round(x), y: Math.round(y), flipX: !!flipX, name: name || s.name };
  if (props && Object.keys(props).length) o.props = { ...props };
  l.objects.push(o);
  renderLayer(doc, li);
  return o;
}
export function findObject(doc, id) {
  for (let li = 0; li < doc.layers.length; li++) { const objs = doc.layers[li].objects || []; const i = objs.findIndex((o) => o.id === id || (o.name && o.name.toLowerCase() === String(id).toLowerCase())); if (i >= 0) return { layer: li, index: i, obj: objs[i] }; }
  throw new Error(`No object "${id}"`);
}
// Topmost object on a layer under x,y (opaque pixel first, then bounding box).
export function objectAt(doc, li, x, y, f = 0) {
  const objs = (doc.layers[li] && doc.layers[li].objects) || [];
  let box = null;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i], s = (doc.sprites || []).find((q) => q.id === o.sprite); if (!s) continue;
    const lx = x - o.x, ly = y - o.y; if (lx < 0 || ly < 0 || lx >= s.w || ly >= s.h) continue;
    const px = s.frames[f % s.frames.length], sx = o.flipX ? s.w - 1 - lx : lx;
    if (px[(ly * s.w + sx) * 4 + 3]) return o;
    box = box || o;
  }
  return box;
}
export const objectSize = (doc, o) => { const s = (doc.sprites || []).find((q) => q.id === o.sprite); return s ? { w: s.w, h: s.h } : { w: 0, h: 0 }; };

// ----- rendering derived layers -----
export function renderLayer(doc, li, frames = null) {
  const l = doc.layers[li], W = doc.width, H = doc.height;
  if (!isDerived(l)) return;
  if (l.type === "tilemap") {
    const ts = getTileset(doc, l.tileset), { cols, rows } = ensureMap(doc, l, ts), buf = new Uint8ClampedArray(W * H * 4);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const t = l.map[r * cols + c]; if (t && ts.tiles[t - 1]) blit(buf, W, H, ts.tiles[t - 1], ts.tw, ts.th, c * ts.tw, r * ts.th); }
    let first = true;
    doc.frames.forEach((fr, f) => { if (frames && !frames.includes(f)) return; fr.cels[li] = first ? buf : new Uint8ClampedArray(buf); first = false; });
    return;
  }
  const sprites = new Map((doc.sprites || []).map((s) => [s.id, s]));
  doc.frames.forEach((fr, f) => {
    if (frames && !frames.includes(f)) return;
    const buf = new Uint8ClampedArray(W * H * 4);
    for (const o of l.objects || []) { const s = sprites.get(o.sprite); if (s && s.frames.length) blit(buf, W, H, s.frames[f % s.frames.length], s.w, s.h, o.x, o.y, o.flipX, true); }
    fr.cels[li] = buf;
  });
}
export function renderDerived(doc) { doc.layers.forEach((l, i) => { if (isDerived(l)) renderLayer(doc, i); }); }

// ----- slices -----
export function addSlice(doc, { name, kind = "slice", x = 0, y = 0, w = 1, h = 1, color, pivot, props } = {}) {
  const s = { id: uid("sl"), name: name || `${kind[0].toUpperCase() + kind.slice(1)} ${(doc.slices || []).length + 1}`, kind, color: color || SLICE_COLORS[kind] || "#2fb8e0", x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  if (pivot) s.pivot = { x: Math.round(pivot.x), y: Math.round(pivot.y) };
  if (props && Object.keys(props).length) s.props = { ...props };
  (doc.slices ||= []).push(s);
  return s;
}
export const getSlice = (doc, id) => byName(doc.slices, id, "slice");
// The slice's rectangle on frame f (its latest per-frame key at or before f, else its base rect).
export function sliceRect(doc, s, f = 0) {
  let r = s;
  if (s.keys) for (let i = 0; i <= f && i < doc.frames.length; i++) { const k = s.keys[doc.frames[i].id]; if (k) r = k; }
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}
// Move / resize a slice. With a frame index, only that frame onward changes (a per-frame key).
export function setSliceRect(doc, s, rect, f = null) {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) };
  if (f == null || f === 0 && !s.keys) Object.assign(s, r);
  else (s.keys ||= {})[doc.frames[f].id] = r;
}
export function sliceAt(doc, x, y, f = 0) { const ss = doc.slices || []; for (let i = ss.length - 1; i >= 0; i--) { const r = sliceRect(doc, ss[i], f); if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return ss[i]; } return null; }

// ---------- GIF encoder (animated, transparent) ----------
export function encodeGIF(doc, { scale = 1 } = {}) {
  const w = doc.width * scale, h = doc.height * scale;
  const frames = doc.frames.map((_, f) => scaleBuffer(compositeFrame(doc, f, { skipReference: true }), doc.width, doc.height, scale));
  // Global palette: index 0 = transparent, then every opaque colour (quantised to 255 if needed).
  const counts = new Map();
  for (const px of frames) for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 128) { const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
  let colors = [...counts.keys()];
  let quant = null;
  if (colors.length > 255) {
    // Reduce by keeping the 255 most used colours and mapping the rest to the nearest one.
    colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255).map(([k]) => k);
    quant = new Map();
  }
  const index = new Map(colors.map((k, i) => [k, i + 1]));
  const nearest = (k) => {
    if (quant.has(k)) return quant.get(k);
    let best = 1, bd = Infinity; const r = k >> 16, g = (k >> 8) & 255, b = k & 255;
    colors.forEach((c, i) => { const d = (r - (c >> 16)) ** 2 + (g - ((c >> 8) & 255)) ** 2 + (b - (c & 255)) ** 2; if (d < bd) { bd = d; best = i + 1; } });
    quant.set(k, best); return best;
  };
  let bits = 1; while (1 << bits < colors.length + 1) bits++;
  bits = Math.max(2, bits);
  const tableSize = 1 << bits;
  const out = [];
  const u8 = (...v) => out.push(...v), u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  [..."GIF89a"].forEach((c) => out.push(c.charCodeAt(0)));
  u16(w); u16(h); u8(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) { const k = i === 0 || i > colors.length ? 0 : colors[i - 1]; u8(k >> 16, (k >> 8) & 255, k & 255); }
  if (frames.length > 1) { u8(0x21, 0xff, 11); [..."NETSCAPE2.0"].forEach((c) => out.push(c.charCodeAt(0))); u8(3, 1); u16(0); u8(0); }
  frames.forEach((px, f) => {
    u8(0x21, 0xf9, 4, 0b00001001); u16(Math.max(2, Math.round(frameDuration(doc, f) / 10))); u8(0, 0); // dispose=restore bg, transparent idx 0
    u8(0x2c); u16(0); u16(0); u16(w); u16(h); u8(0);
    const idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      if (px[i + 3] < 128) continue;
      const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      idx[p] = index.get(k) ?? nearest(k);
    }
    const data = lzw(idx, bits);
    u8(bits);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.subarray(i, i + 255); out.push(chunk.length); for (const b of chunk) out.push(b); }
    u8(0);
  });
  u8(0x3b);
  return new Uint8Array(out);
}
function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1, out = [];
  let size = minCode + 1, next = eoi + 1, dict = new Map(), cur = 0, curBits = 0;
  const emit = (code) => { cur |= code << curBits; curBits += size; while (curBits >= 8) { out.push(cur & 255); cur >>= 8; curBits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > 1 << size && size < 12) size++; }
    else { emit(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return new Uint8Array(out);
}
