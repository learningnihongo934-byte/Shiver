// Generated cover art for games without a thumbnail: fog, a doorway of light, a figure, the title.
const PALETTES = {
  retro: ['#1a0606', '#5a1010', '#e8d8b0'],
  vhs: ['#060812', '#1c2a5a', '#d0e0ff'],
  hd: ['#141006', '#6a5a20', '#fff2c0'],
  noir: ['#080808', '#3a3a3a', '#f0f0f0'],
  pixel: ['#05060c', '#203050', '#c0d8ff'],
};

function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export function coverCanvas(game, w = 480, h = 270) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  let s = hash(game.id + game.title);
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
  const [dark, mid, light] = PALETTES[game.style] || PALETTES.retro;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, dark); bg.addColorStop(1, '#000');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // corridor perspective
  const cx = w * (0.35 + r() * 0.3), cy = h * 0.52;
  const dw = w * 0.09, dh = h * 0.32;
  g.strokeStyle = mid; g.globalAlpha = 0.5;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(cx + (x ? dw : -dw) / 2, cy + (y ? dh : -dh) / 2); g.stroke(); }
  g.globalAlpha = 1;
  const glow = g.createRadialGradient(cx, cy, 2, cx, cy, w * 0.45);
  glow.addColorStop(0, light); glow.addColorStop(0.08, mid); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, w, h);
  g.fillStyle = light; g.globalAlpha = 0.85;
  g.fillRect(cx - dw / 2, cy - dh / 2, dw, dh);
  g.globalAlpha = 1;
  // figure in the doorway
  g.fillStyle = '#000';
  const fh = dh * (0.7 + r() * 0.25), fw = fh * 0.22;
  g.fillRect(cx - fw / 2, cy + dh / 2 - fh, fw, fh);
  g.beginPath(); g.arc(cx, cy + dh / 2 - fh - fw * 0.35, fw * 0.45, 0, 7); g.fill();
  // noise
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 40; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  // vignette + title
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  g.font = `${Math.round(h * 0.13)}px "Special Elite", Courier, monospace`;
  g.fillStyle = '#eee4cc'; g.textBaseline = 'bottom';
  g.shadowColor = '#000'; g.shadowBlur = 10;
  g.fillText(game.title.toUpperCase().slice(0, 22), w * 0.05, h * 0.93);
  return c;
}

export function coverInto(elm, game) {
  if (game.hasThumb) {
    elm.style.backgroundImage = `url(/api/thumb/${game.id}?v=${game.updated || 0})`;
  } else {
    elm.appendChild(coverCanvas(game));
  }
}

export function coverURL(game) {
  return game.hasThumb ? `/api/thumb/${game.id}?v=${game.updated || 0}` : coverCanvas(game, 1280, 720).toDataURL('image/jpeg', 0.85);
}
