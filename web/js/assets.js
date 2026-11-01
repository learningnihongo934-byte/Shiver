// Importing art into a game: Pixeter projects (.pixeter), Pixeter/Aseprite sprite sheets (PNG + JSON)
// and plain images. Everything becomes a PNG sprite sheet plus frame timings and animation tags.
import * as PX from './vendor/pixeter-core.js';

const cleanName = (s) => s.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'art';

function toDataURL(pixels, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
  return c.toDataURL('image/png');
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      resolve({ canvas: c, w: c.width, h: c.height });
    };
    img.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    img.src = URL.createObjectURL(file);
  });
}

const tagsFrom = (list) => (list || []).map((t) => ({ name: String(t.name), from: t.from, to: t.to, dir: t.dir || t.direction || 'forward' }));

export function fromPixeterDoc(doc, name) {
  const sheet = PX.spritesheet(doc, {});
  return {
    name: cleanName(name || doc.name), source: 'pixeter', kind: doc.frames.length > 1 ? 'sprite' : 'image',
    data: toDataURL(sheet.pixels, sheet.width, sheet.height),
    w: doc.width, h: doc.height, cols: sheet.cols, rows: sheet.rows, frames: sheet.frames.map((f) => f.duration), tags: tagsFrom(doc.tags),
  };
}

// files: a FileList / array (a PNG and its sheet JSON can be dropped together)
export async function importFiles(files) {
  files = [...files];
  const out = [];
  const jsons = new Map();
  for (const f of files) if (/\.json$/i.test(f.name)) jsons.set(cleanName(f.name), JSON.parse(await f.text()));
  for (const f of files) {
    if (/\.pixeter$/i.test(f.name)) {
      out.push(fromPixeterDoc(PX.deserialize(await f.text()), f.name));
    } else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name)) {
      const { canvas, w, h } = await readImage(f);
      if (w > 2048 || h > 2048) throw new Error(`${f.name} is too big (max 2048×2048)`);
      const meta = jsons.get(cleanName(f.name));
      const asset = { name: cleanName(f.name), source: 'image', kind: 'image', data: canvas.toDataURL('image/png'), w, h, cols: 1, rows: 1, frames: [100], tags: [] };
      if (meta) {
        // Pixeter sheet JSON (cols/rows/frameSize) or Aseprite JSON (frames with rects)
        const frames = Array.isArray(meta.frames) ? meta.frames : Object.values(meta.frames || {});
        const fw = meta.frameSize?.w || frames[0]?.frame?.w || w, fh = meta.frameSize?.h || frames[0]?.frame?.h || h;
        Object.assign(asset, {
          source: meta.app === 'pixeter' ? 'pixeter' : 'sheet', kind: frames.length > 1 ? 'sprite' : 'image', w: fw, h: fh,
          cols: meta.cols || Math.max(1, Math.round(w / fw)), rows: meta.rows || Math.max(1, Math.round(h / fh)),
          frames: frames.length ? frames.map((fr) => fr.duration || 100) : [100], tags: tagsFrom(meta.frameTags || meta.meta?.frameTags),
        });
      }
      out.push(asset);
    } else if (!/\.json$/i.test(f.name)) {
      throw new Error(`Can't import ${f.name}. Use .pixeter files from pixeter.app, PNG/JPEG/GIF images, or a sprite sheet PNG with its JSON.`);
    }
  }
  for (const a of out) if (a.data.length > 1_400_000) throw new Error(`${a.name} is over 1 MB. Try a smaller sheet.`);
  return out;
}

// Blob store client: data URLs by hash, cached.
const cache = new Map();
export async function blobData(hash) {
  if (cache.has(hash)) return cache.get(hash);
  const p = fetch('/api/blob/' + hash)
    .then((r) => { if (!r.ok) throw new Error('missing asset'); return r.blob(); })
    .then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }));
  cache.set(hash, p);
  return p;
}

// Make sure every asset has its image data (for handing to the game).
export async function withData(assets = []) {
  return Promise.all(assets.map(async (a) => (a.data ? a : { ...a, data: await blobData(a.hash).catch(() => null) })));
}
