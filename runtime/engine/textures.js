// Procedural textures (no image files) and a cached material factory.
import * as THREE from '/vendor/three/three.module.js';
import { SNAP } from './render.js';

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const S = 64;
const DRAW = {
  concrete(g, r) { fill(g, '#6a6964'); speckle(g, r, 900, ['#5d5c58', '#77766f', '#55544f']); stains(g, r, 5, 'rgba(30,28,20,0.22)'); crack(g, r, 2); },
  plaster(g, r) { fill(g, '#b9b4a6'); speckle(g, r, 500, ['#aea999', '#c4bfb1']); stains(g, r, 6, 'rgba(90,70,40,0.18)'); crack(g, r, 1); },
  tiles(g, r) {
    fill(g, '#9fb0a3');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 150 + r() * 30;
      g.fillStyle = r() < 0.12 ? `rgb(${v - 40},${v - 30},${v - 50})` : `rgb(${v - 10},${v + 8},${v - 4})`;
      g.fillRect(x * 16 + 1, y * 16 + 1, 15, 15);
    }
    speckle(g, r, 300, ['rgba(60,60,40,0.25)']); stains(g, r, 3, 'rgba(70,50,20,0.25)');
  },
  floortiles(g, r) {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = (x + y) % 2 ? 70 : 160;
      g.fillStyle = `rgb(${v + r() * 15},${v + r() * 15},${v - 5 + r() * 10})`;
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    speckle(g, r, 400, ['rgba(20,20,10,0.3)']); stains(g, r, 4, 'rgba(40,30,10,0.3)');
  },
  wallpaper(g, r) {
    fill(g, '#c2ad55');
    for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(120,100,30,0.35)'; g.fillRect(x, 0, 2, 64); }
    for (let y = 4; y < 64; y += 16) for (let x = 4; x < 64; x += 16) { g.fillStyle = 'rgba(140,115,35,0.5)'; g.fillRect(x - 1, y - 2, 3, 5); g.fillRect(x - 2, y - 1, 5, 3); }
    speckle(g, r, 300, ['rgba(90,70,20,0.25)']); stains(g, r, 3, 'rgba(90,60,10,0.2)');
  },
  carpet(g, r) { fill(g, '#9a8540'); speckle(g, r, 1600, ['#8c7836', '#a8934a', '#7e6c30', '#b09a50']); stains(g, r, 3, 'rgba(60,40,10,0.25)'); },
  ceiling(g, r) {
    fill(g, '#cfcbbd');
    g.fillStyle = '#8f8b7f';
    g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64); g.fillRect(0, 32, 64, 2); g.fillRect(32, 0, 2, 64);
    speckle(g, r, 400, ['#b5b1a3', '#a19d90']); stains(g, r, 2, 'rgba(110,80,30,0.3)');
  },
  wood(g, r) {
    for (let y = 0; y < 64; y += 8) {
      const v = 70 + r() * 25;
      g.fillStyle = `rgb(${v + 30},${v + 10},${v - 15})`;
      g.fillRect(0, y, 64, 8);
      g.fillStyle = 'rgba(30,15,5,0.6)';
      g.fillRect(0, y, 64, 1);
      g.fillRect(Math.floor(r() * 64), y, 1, 8);
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(40,20,5,0.25)'; g.fillRect(Math.floor(r() * 64), y + 2 + Math.floor(r() * 5), 6 + r() * 14, 1); }
    }
  },
  door(g, r) {
    DRAW.wood(g, r);
    g.strokeStyle = 'rgba(25,12,4,0.7)'; g.lineWidth = 2;
    g.strokeRect(8, 6, 48, 22); g.strokeRect(8, 36, 48, 22);
  },
  metal(g, r) {
    fill(g, '#5d6366');
    speckle(g, r, 500, ['#54595c', '#686e71']);
    for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(160,170,175,0.25)'; g.beginPath(); const x = r() * 64, y = r() * 64; g.moveTo(x, y); g.lineTo(x + r() * 20 - 10, y + r() * 6 - 3); g.stroke(); }
    g.fillStyle = '#3a3e40';
    for (const [x, y] of [[4, 4], [60, 4], [4, 60], [60, 60]]) g.fillRect(x - 1, y - 1, 3, 3);
    stains(g, r, 3, 'rgba(110,50,15,0.3)');
  },
  rust(g, r) { fill(g, '#6b3a1e'); speckle(g, r, 1200, ['#7d4524', '#5a2f17', '#8c5530', '#4a2612']); },
  brick(g, r) {
    fill(g, '#5a5650');
    for (let y = 0; y < 8; y++) for (let x = -1; x < 4; x++) {
      const v = 95 + r() * 40;
      g.fillStyle = `rgb(${v + 20},${v * 0.5},${v * 0.4})`;
      g.fillRect(x * 16 + (y % 2) * 8 + 1, y * 8 + 1, 14, 6);
    }
    stains(g, r, 3, 'rgba(20,20,20,0.3)');
  },
  dirt(g, r) { fill(g, '#3e3122'); speckle(g, r, 1500, ['#4a3a28', '#33281b', '#55442f', '#2a2116']); },
  grass(g, r) {
    fill(g, '#26331c'); speckle(g, r, 800, ['#2e3d22', '#1f2a17']);
    for (let i = 0; i < 260; i++) { g.fillStyle = r() < 0.5 ? '#3b4d29' : '#1a2413'; g.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 2 + Math.floor(r() * 3)); }
  },
  stone(g, r) {
    fill(g, '#4b4b4b');
    for (let i = 0; i < 18; i++) { const v = 70 + r() * 40; g.fillStyle = `rgb(${v},${v},${v - 4})`; g.beginPath(); g.ellipse(r() * 64, r() * 64, 5 + r() * 8, 4 + r() * 6, r() * 3, 0, 7); g.fill(); }
    speckle(g, r, 400, ['rgba(0,0,0,0.25)']);
  },
  hazard(g) { fill(g, '#1a1a1a'); g.fillStyle = '#c9a417'; for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); } },
  paper(g, r) { fill(g, '#d8d0b8'); g.fillStyle = 'rgba(80,90,140,0.35)'; for (let y = 10; y < 64; y += 6) g.fillRect(4, y, 56, 1); speckle(g, r, 120, ['rgba(90,70,30,0.2)']); g.fillStyle = 'rgba(30,30,30,0.7)'; for (let y = 8; y < 60; y += 6) g.fillRect(6, y, 10 + r() * 40, 1); },
  blood(g, r) {
    g.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${90 + r() * 40},0,0,${0.6 + r() * 0.4})`; g.beginPath(); g.arc(20 + r() * 24, 20 + r() * 24, 3 + r() * 12, 0, 7); g.fill(); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(110,0,0,0.9)'; g.fillRect(r() * 64, r() * 64, 1 + r() * 2, 1 + r() * 2); }
  },
  static(g, r) { const d = g.createImageData(64, 64); for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); },
};

function fill(g, c) { g.fillStyle = c; g.fillRect(0, 0, S, S); }
function speckle(g, r, n, colors) { for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 1); } }
function stains(g, r, n, c) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rad = 4 + r() * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}
function crack(g, r, n) {
  g.strokeStyle = 'rgba(25,25,25,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < n; i++) { let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += r() * 10 - 5; y += r() * 10; g.lineTo(x, y); } g.stroke(); }
}

const texCache = new Map();
export const TEXTURE_NAMES = Object.keys(DRAW);
export let smoothTextures = false;
export function setSmoothTextures(v) {
  smoothTextures = v;
  for (const t of texCache.values()) { t.magFilter = v ? THREE.LinearFilter : THREE.NearestFilter; t.minFilter = v ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter; t.needsUpdate = true; }
}

// ---- game assets (Pixeter art / images imported in the Studio) ----
const ASSETS = new Map();
const assetTex = new Map();
export function setAssets(list) {
  ASSETS.clear();
  assetTex.clear();
  for (const a of list || []) if (a?.name && a.data) ASSETS.set(a.name, a);
}
export const getAsset = (name) => ASSETS.get(name) || null;
export const assetNames = () => [...ASSETS.keys()];
export function assetTexture(name) {
  if (assetTex.has(name)) return assetTex.get(name);
  const a = ASSETS.get(name);
  if (!a) return null;
  const img = new Image();
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.clones = [];
  img.onload = () => { t.needsUpdate = true; for (const c of t.clones) c.needsUpdate = true; };
  img.src = a.data;
  assetTex.set(name, t);
  return t;
}

export function texture(name) {
  if (!name) return null;
  if (name.startsWith('asset:')) return assetTexture(name.slice(6));
  if (texCache.has(name)) return texCache.get(name);
  const draw = DRAW[name];
  if (!draw) return null;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  draw(g, prng([...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = smoothTextures ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = smoothTextures ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;
  texCache.set(name, t);
  return t;
}

// TV static that keeps changing.
let staticFrame = 0;
export function tickTextures() {
  const t = texCache.get('static');
  if (!t || ++staticFrame % 3) return;
  DRAW.static(t.image.getContext('2d'), prng(staticFrame));
  t.needsUpdate = true;
}

export function snapify(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = SNAP;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nif (uSnap.x > 0.0) { vec4 sp = gl_Position; sp.xy = floor(sp.xy / sp.w * uSnap + 0.5) / uSnap * sp.w; gl_Position = sp; }',
    );
  };
  mat.customProgramCacheKey = () => 'snap';
  return mat;
}

const matCache = new Map();
// opts: {color, texture, emissive, emissiveIntensity, opacity, double, unlit, metal, rough}
export function material(opts = {}) {
  const key = JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const transparent = opts.opacity != null && opts.opacity < 1;
  const base = {
    color: new THREE.Color(opts.color ?? (opts.texture ? 0xffffff : 0x888888)),
    map: texture(opts.texture),
    transparent: transparent || opts.texture === 'blood',
    opacity: opts.opacity ?? 1,
    side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !transparent,
  };
  if (opts.texture === 'blood') base.alphaTest = 0.1;
  if (opts.texture?.startsWith('asset:')) base.alphaTest = 0.5;
  let m;
  if (opts.unlit) m = new THREE.MeshBasicMaterial({ ...base, fog: opts.fog !== false });
  else m = new THREE.MeshStandardMaterial({
    ...base,
    roughness: opts.rough ?? 0.92,
    metalness: opts.metal ?? 0,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  snapify(m);
  matCache.set(key, m);
  return m;
}

// Box geometry whose UVs are scaled to world size so textures tile instead of stretching.
const geoCache = new Map();
export function boxGeometry(w, h, d, texScale = 2) {
  const key = [w, h, d, texScale].map((v) => +v.toFixed(3)).join('|');
  if (geoCache.has(key)) return geoCache.get(key);
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const idx = f * 4 + i;
    uv.setXY(idx, (uv.getX(idx) * faces[f][0]) / texScale, (uv.getY(idx) * faces[f][1]) / texScale);
  }
  geoCache.set(key, geo);
  return geo;
}
