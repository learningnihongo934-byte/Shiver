// Shiver's built-in sprite editor: pixel drawing + frame animation on top of Pixeter's core, so
// everything it makes is a real Pixeter document (download it to keep working at pixeter.app).
import * as PX from './vendor/pixeter-core.js';
import { fromPixeterDoc, blobData } from './assets.js';
import { esc } from './api.js';
import { modal } from './app.js';

const TOOLS = [['pencil', '✎', 'B'], ['eraser', '⌫', 'E'], ['fill', '▧', 'G'], ['line', '╱', 'L'], ['rect', '▭', 'R'], ['ellipse', '◯', 'O'], ['picker', '⊙', 'I']];
const HORROR = ['#000000', '#0b0606', '#1a0a0b', '#2e0e10', '#4a1416', '#7a1a1c', '#b3161b', '#ff3a30', '#ffffff', '#ece4d0', '#b9ae98', '#8c8170', '#5a5248', '#3a342e', '#222034', '#3f3f74', '#5b6ee1', '#8fb6ff', '#2e7a3a', '#58b048', '#c9a227', '#f4d040', '#8a5a34', '#c48a50'];

// Turns a stored asset (PNG sheet + meta) back into an editable Pixeter document.
async function docFromAsset(a) {
  const data = a.data || (await blobData(a.hash));
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = data; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const frames = [];
  for (let i = 0; i < (a.frames?.length || 1); i++) {
    const ox = (i % a.cols) * a.w, oy = Math.floor(i / a.cols) * a.h;
    const cel = new Uint8ClampedArray(a.w * a.h * 4);
    for (let y = 0; y < a.h; y++) cel.set(px.subarray(((oy + y) * c.width + ox) * 4, ((oy + y) * c.width + ox + a.w) * 4), y * a.w * 4);
    frames.push(cel);
  }
  const doc = PX.docFromImages(frames, a.w, a.h, a.name);
  doc.frames.forEach((f, i) => (f.duration = a.frames?.[i] || null));
  doc.fps = Math.round(1000 / (a.frames?.[0] || 125));
  doc.tags = (a.tags || []).map((t) => ({ ...t, color: '#b3161b' }));
  for (const c2 of HORROR) if (!doc.palette.includes(c2)) doc.palette.push(c2);
  return doc;
}

// opts: { asset? (edit an existing one), onSave(asset) }
export async function openSpriteEditor(opts = {}) {
  let doc = opts.asset ? await docFromAsset(opts.asset) : PX.createDoc({ width: 32, height: 32, name: 'sprite', palette: HORROR, fps: 8 });
  let frame = 0, tool = 'pencil', color = '#ece4d0', mirror = false, onion = true;
  const undo = [], redo = [];

  const m = modal(`
    <div class="sed">
      <div class="sed-top">
        <input class="sed-name" maxlength="32" value="${esc(doc.name)}" title="Asset name (use it in code as world.sprite('name'))">
        <select class="sed-size" title="Canvas size">${[[16, 16], [16, 24], [24, 24], [24, 32], [32, 32], [32, 48], [48, 48], [64, 64]].map(([w, h]) => `<option value="${w}x${h}" ${w === doc.width && h === doc.height ? 'selected' : ''}>${w}×${h}</option>`).join('')}</select>
        <label class="sed-chk"><input type="checkbox" class="sed-mirror"> mirror</label>
        <label class="sed-chk"><input type="checkbox" class="sed-onion" checked> onion skin</label>
        <span style="flex:1"></span>
        <button class="btn small ghost" data-x="undo" title="Ctrl/Cmd+Z">↶</button><button class="btn small ghost" data-x="redo" title="Ctrl/Cmd+Shift+Z">↷</button>
        <button class="btn small ghost" data-x="flip" title="Flip this frame horizontally">⇋ flip</button>
        <button class="btn small ghost" data-x="outline" title="Add a dark outline to this frame">▣ outline</button>
        <button class="btn small ghost" data-x="clear">clear</button>
      </div>
      <div class="sed-body">
        <div class="sed-tools">${TOOLS.map(([t, icon, key]) => `<button data-tool="${t}" title="${t} (${key})">${icon}</button>`).join('')}</div>
        <div class="sed-stage"><canvas class="sed-canvas"></canvas></div>
        <div class="sed-side">
          <div class="sed-cur"><span class="sed-swatch"></span><input type="color" class="sed-pick" value="${color}"></div>
          <div class="sed-pal"></div>
          <h5>PREVIEW</h5><canvas class="sed-prev"></canvas>
          <label class="sed-row">fps <input type="range" min="1" max="24" class="sed-fps" value="${doc.fps}"><b class="sed-fpsv">${doc.fps}</b></label>
          <h5>ANIMATIONS</h5>
          <input class="sed-tags" placeholder="idle 1-2, walk 3-6" value="${esc((doc.tags || []).map((t) => `${t.name} ${t.from + 1}-${t.to + 1}`).join(', '))}" title="Name frame ranges. Monsters play idle / walk / run / chase automatically.">
        </div>
      </div>
      <div class="sed-frames"><div class="sed-strip"></div><button class="btn small" data-x="add">+ frame</button><button class="btn small ghost" data-x="dup">⧉ copy</button><button class="btn small ghost" data-x="del">✕ delete</button><button class="btn small ghost" data-x="left">◀</button><button class="btn small ghost" data-x="right">▶</button></div>
      <div class="acts"><button class="btn ghost" data-x="pixeter" title="Download a .pixeter file to keep editing with layers, tilemaps and more at pixeter.app">⬇ .pixeter</button><a class="btn ghost" href="https://pixeter.app" target="_blank">Open Pixeter ↗</a><span style="flex:1"></span><button class="btn ghost" data-x="cancel">Cancel</button><button class="btn red" data-x="save">Save to game</button></div>
    </div>`, { wide: true });
  m.root.classList.add('sed-modal');
  const $ = (s) => m.root.querySelector(s);
  const cv = $('.sed-canvas'), g = cv.getContext('2d');
  const prev = $('.sed-prev'), pg = prev.getContext('2d');
  const off = document.createElement('canvas'), og = off.getContext('2d');

  let zoom = 1;
  function layout() {
    zoom = Math.max(2, Math.floor(Math.min(520 / doc.width, 440 / doc.height)));
    cv.width = doc.width * zoom;
    cv.height = doc.height * zoom;
    off.width = doc.width;
    off.height = doc.height;
    prev.width = doc.width * Math.max(1, Math.floor(96 / Math.max(doc.width, doc.height)));
    prev.height = (prev.width / doc.width) * doc.height;
  }
  const cel = (f = frame) => doc.frames[f].cels[0];
  const imageOf = (f) => new ImageData(new Uint8ClampedArray(PX.compositeFrame(doc, f)), doc.width, doc.height);

  function draw() {
    g.imageSmoothingEnabled = false;
    // checkerboard
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) { g.fillStyle = (x + y) % 2 ? '#1c1818' : '#141111'; g.fillRect(x * zoom, y * zoom, zoom, zoom); }
    if (onion && frame > 0) {
      og.putImageData(imageOf(frame - 1), 0, 0);
      g.globalAlpha = 0.25;
      g.drawImage(off, 0, 0, cv.width, cv.height);
      g.globalAlpha = 1;
    }
    og.putImageData(imageOf(frame), 0, 0);
    g.drawImage(off, 0, 0, cv.width, cv.height);
    if (zoom >= 8) {
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      for (let x = 1; x < doc.width; x++) { g.moveTo(x * zoom + 0.5, 0); g.lineTo(x * zoom + 0.5, cv.height); }
      for (let y = 1; y < doc.height; y++) { g.moveTo(0, y * zoom + 0.5); g.lineTo(cv.width, y * zoom + 0.5); }
      g.stroke();
    }
    if (mirror) { g.strokeStyle = 'rgba(179,22,27,0.6)'; g.beginPath(); g.moveTo(cv.width / 2, 0); g.lineTo(cv.width / 2, cv.height); g.stroke(); }
  }

  function renderStrip() {
    const strip = $('.sed-strip');
    strip.innerHTML = '';
    doc.frames.forEach((_, i) => {
      const c = document.createElement('canvas');
      c.width = doc.width;
      c.height = doc.height;
      c.getContext('2d').putImageData(imageOf(i), 0, 0);
      const b = document.createElement('button');
      b.className = 'sed-fr' + (i === frame ? ' on' : '');
      b.title = `Frame ${i + 1}`;
      b.append(c, Object.assign(document.createElement('span'), { textContent: i + 1 }));
      b.onclick = () => { frame = i; refresh(); };
      strip.appendChild(b);
    });
  }

  function renderPalette() {
    const pal = $('.sed-pal');
    pal.innerHTML = '';
    for (const c of doc.palette.slice(0, 48)) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.className = c === color ? 'on' : '';
      b.onclick = () => setColor(c);
      pal.appendChild(b);
    }
    $('.sed-swatch').style.background = color;
    $('.sed-pick').value = color.slice(0, 7);
  }
  function setColor(c) { color = c; if (!doc.palette.includes(c)) doc.palette.push(c); renderPalette(); }
  function setTool(t) { tool = t; m.root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); }
  function refresh() { draw(); renderStrip(); }

  // ---------------------------------------------------------------- drawing
  const snapshot = () => ({ frame, data: new Uint8ClampedArray(cel()) });
  const push = () => { undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo.length = 0; };
  const rgba = () => (tool === 'eraser' ? [0, 0, 0, 0] : PX.hexToRgba(color));
  const plot = (pts) => {
    const c = rgba(), buf = cel();
    for (const [x, y] of pts) {
      PX.setPx(buf, doc.width, doc.height, x, y, c);
      if (mirror) PX.setPx(buf, doc.width, doc.height, doc.width - 1 - x, y, c);
    }
  };
  const cell = (ev) => {
    const r = cv.getBoundingClientRect();
    return [Math.floor(((ev.clientX - r.left) / r.width) * doc.width), Math.floor(((ev.clientY - r.top) / r.height) * doc.height)];
  };
  let drag = null;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (ev) => {
    cv.setPointerCapture(ev.pointerId);
    const [x, y] = cell(ev);
    const prevTool = tool;
    if (ev.button === 2) tool = 'eraser';
    if (tool === 'picker') {
      const p = PX.getPx(PX.compositeFrame(doc, frame), doc.width, doc.height, x, y);
      if (p && p[3]) setColor(PX.rgbaToHex([p[0], p[1], p[2], 255]));
      tool = prevTool;
      return;
    }
    push();
    if (tool === 'fill') { plot(PX.fillPoints(cel(), doc.width, doc.height, x, y, !ev.shiftKey)); refresh(); tool = prevTool; return; }
    drag = { x, y, base: new Uint8ClampedArray(cel()), prevTool };
    if (tool === 'pencil' || tool === 'eraser') plot([[x, y]]);
    draw();
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const [x, y] = cell(ev);
    if (tool === 'pencil' || tool === 'eraser') { plot(PX.linePoints(drag.x, drag.y, x, y)); drag.x = x; drag.y = y; }
    else {
      cel().set(drag.base);
      if (tool === 'line') plot(PX.linePoints(drag.x, drag.y, x, y));
      if (tool === 'rect') plot(PX.rectPoints(drag.x, drag.y, x, y, ev.shiftKey));
      if (tool === 'ellipse') plot(PX.ellipsePoints(drag.x, drag.y, x, y, ev.shiftKey));
    }
    draw();
  });
  const end = () => { if (!drag) return; tool = drag.prevTool; drag = null; refresh(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  function history(from, to) {
    const s = from.pop();
    if (!s) return;
    to.push({ frame: s.frame, data: new Uint8ClampedArray(doc.frames[s.frame].cels[0]) });
    doc.frames[s.frame].cels[0].set(s.data);
    frame = s.frame;
    refresh();
  }

  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? history(redo, undo) : history(undo, redo); return; }
    const t = TOOLS.find(([, , k]) => k === e.key.toUpperCase());
    if (t && !e.metaKey && !e.ctrlKey) setTool(t[0]);
    if (e.key === ',' && frame > 0) { frame--; refresh(); }
    if (e.key === '.' && frame < doc.frames.length - 1) { frame++; refresh(); }
  };
  addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- frames + misc buttons
  m.root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]')?.dataset.tool;
    if (t) return setTool(t);
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'add') { doc.frames.splice(frame + 1, 0, PX.newFrame(doc)); frame++; }
    if (x === 'dup') { const f = PX.newFrame(doc); f.cels[0].set(cel()); doc.frames.splice(frame + 1, 0, f); frame++; }
    if (x === 'del' && doc.frames.length > 1) { doc.frames.splice(frame, 1); frame = Math.min(frame, doc.frames.length - 1); }
    if (x === 'left' && frame > 0) { [doc.frames[frame - 1], doc.frames[frame]] = [doc.frames[frame], doc.frames[frame - 1]]; frame--; }
    if (x === 'right' && frame < doc.frames.length - 1) { [doc.frames[frame + 1], doc.frames[frame]] = [doc.frames[frame], doc.frames[frame + 1]]; frame++; }
    if (x === 'undo') history(undo, redo);
    if (x === 'redo') history(redo, undo);
    if (x === 'clear') { push(); cel().fill(0); }
    if (x === 'flip') {
      push();
      const src = new Uint8ClampedArray(cel()), w = doc.width;
      for (let y = 0; y < doc.height; y++) for (let xx = 0; xx < w; xx++) for (let k = 0; k < 4; k++) cel()[(y * w + xx) * 4 + k] = src[(y * w + (w - 1 - xx)) * 4 + k];
    }
    if (x === 'outline') { push(); PX.outlineCel?.(cel(), doc.width, doc.height, PX.hexToRgba('#0b0606')); }
    if (x === 'cancel') return close();
    if (x === 'pixeter') {
      readMeta();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(PX.serialize(doc))], { type: 'application/json' }));
      a.download = doc.name + '.pixeter';
      a.click();
      return;
    }
    if (x === 'save') {
      readMeta();
      opts.onSave?.(fromPixeterDoc(doc, doc.name));
      return close();
    }
    refresh();
  });

  function readMeta() {
    doc.name = $('.sed-name').value.replace(/[^\w-]+/g, '_').slice(0, 32) || 'sprite';
    doc.tags = $('.sed-tags').value.split(',').map((s) => s.trim().match(/^([\w-]+)\s+(\d+)\s*-\s*(\d+)$/)).filter(Boolean)
      .map(([, name, a, b]) => ({ name, from: Math.min(+a, +b) - 1, to: Math.max(+a, +b) - 1, dir: 'forward', color: '#b3161b' }))
      .filter((t) => t.from >= 0 && t.to < doc.frames.length);
    doc.frames.forEach((f) => (f.duration = null));
  }

  $('.sed-size').onchange = (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    PX.resizeDoc(doc, w, h, 'center');
    undo.length = redo.length = 0;
    layout();
    refresh();
  };
  $('.sed-mirror').onchange = (e) => { mirror = e.target.checked; draw(); };
  $('.sed-onion').onchange = (e) => { onion = e.target.checked; draw(); };
  $('.sed-pick').oninput = (e) => setColor(e.target.value);
  $('.sed-fps').oninput = (e) => { doc.fps = +e.target.value; $('.sed-fpsv').textContent = doc.fps; };

  // animation preview
  let pf = 0, acc = 0, last = performance.now(), raf = 0;
  const tick = (now) => {
    if (!m.root.isConnected) return close(); // closed with Esc or a click outside
    raf = requestAnimationFrame(tick);
    acc += now - last;
    last = now;
    if (acc > 1000 / doc.fps) { acc = 0; pf = (pf + 1) % doc.frames.length; }
    og.putImageData(imageOf(Math.min(pf, doc.frames.length - 1)), 0, 0);
    pg.imageSmoothingEnabled = false;
    pg.clearRect(0, 0, prev.width, prev.height);
    pg.drawImage(off, 0, 0, prev.width, prev.height);
  };
  raf = requestAnimationFrame(tick);

  function close() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    m.close();
  }

  layout();
  setTool('pencil');
  renderPalette();
  refresh();
}
