// Shiver's platform logic: accounts, the game catalogue, the studio, publishing and assets.
// Platform-neutral: the Node server and the Cloudflare Worker both call api() and use Rooms.
import { newId, sha256, publicUser } from './store.js';
import { Rooms } from './rooms.js';

const LIMITS = { scripts: 40, scriptBytes: 200_000, totalBytes: 600_000, blob: 1_400_000, assets: 48 };
const STYLES = ['retro', 'vhs', 'hd', 'noir', 'pixel'];
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export function createCore({ db, templates }) {
  const ready = seedTemplates(db, templates);
  const rooms = new Rooms(db);

  // req: { method, path, query: URLSearchParams, token, body }
  // returns { status, json } or { status, bytes, type, cache }
  async function api(req) {
    await ready;
    const { method, path: p, query } = req;
    const body = req.body;
    const user = db.userByToken(req.token);
    const ok = (json) => ({ status: 200, json });
    const err = (status, error) => ({ status, json: { error } });
    const m = (re) => p.match(re);
    let r;

    if (p === '/api/signup' && method === 'POST') {
      const name = String(body?.name || '').trim();
      const password = String(body?.password || '');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return err(400, 'Username: 3-20 letters, numbers or _');
      if (password.length < 6) return err(400, 'Password must be at least 6 characters');
      if (db.userByName(name) || name.toLowerCase() === 'shiver') return err(409, 'That username is taken');
      const u = await db.createUser(name, password);
      return ok({ token: db.newSession(u.id), user: publicUser(u) });
    }
    if (p === '/api/login' && method === 'POST') {
      const u = db.userByName(String(body?.name || ''));
      if (!u || !(await db.checkPassword(u, String(body?.password || '')))) return err(401, 'Wrong username or password');
      return ok({ token: db.newSession(u.id), user: publicUser(u) });
    }
    if (p === '/api/me') return ok({ user: publicUser(user) });
    if (p === '/api/ice') return ok({ iceServers: req.ice || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] });
    if (p === '/api/stats') return ok({ online: rooms.onlineCount(), games: db.games().filter((g) => g.published).length });
    if (p === '/api/templates') return ok({ templates: templates.map(({ id, title, description, style, tags }) => ({ id, title, description, style, tags })) });

    if (p === '/api/games' && method === 'GET') {
      const q = (query.get('q') || '').toLowerCase();
      const sort = query.get('sort') || 'popular';
      let list = db.games().filter((g) => g.published);
      if (q) list = list.filter((g) => (g.title + ' ' + g.description + ' ' + (g.tags || []).join(' ')).toLowerCase().includes(q));
      const playing = (g) => rooms.playing(g.id);
      const scores = { popular: (g) => g.plays + g.likes.length * 10 + playing(g) * 50, new: (g) => g.publishedAt, playing: (g) => playing(g) * 1e6 + g.plays, liked: (g) => g.likes.length };
      const score = scores[sort] || scores.popular;
      list.sort((a, b) => score(b) - score(a));
      return ok({ games: list.slice(0, 60).map(summary) });
    }
    if ((r = m(/^\/api\/games\/([\w-]+)$/)) && method === 'GET') {
      const g = db.game(r[1]);
      if (!g || (!g.published && g.owner !== user?.id && !rooms.hasRoom(g.id))) return err(404, 'Game not found');
      return ok({ game: { ...summary(g), liked: !!user && g.likes.includes(user.id), rooms: rooms.publicRooms(g.id) } });
    }
    if ((r = m(/^\/api\/games\/([\w-]+)\/like$/)) && method === 'POST') {
      if (!user) return err(401, 'Log in to like games');
      const g = db.game(r[1]);
      if (!g) return err(404, 'Game not found');
      const i = g.likes.indexOf(user.id);
      if (i >= 0) g.likes.splice(i, 1); else g.likes.push(user.id);
      db.saveGame(g);
      return ok({ liked: i < 0, likes: g.likes.length });
    }
    if ((r = m(/^\/api\/thumb\/([\w-]+)$/))) {
      const g = db.game(r[1]);
      return g?.thumb ? blobResponse(g.thumb, 'public, max-age=300') : err(404, 'No thumbnail');
    }
    if ((r = m(/^\/api\/blob\/([0-9a-f]{64})$/))) return blobResponse(r[1], 'public, max-age=31536000, immutable');
    if (p === '/api/blobs' && method === 'POST') {
      if (!user) return err(401, 'Log in to upload');
      const data = String(body?.data || '');
      if (!IMAGE_URL.test(data) || data.length > LIMITS.blob) return err(400, 'Images must be PNG/JPEG/GIF/WebP under 1 MB');
      const hash = await sha256(data);
      await db.putBlob(hash, data);
      return ok({ hash });
    }

    // ---- creator studio (needs an account) ----
    if (p.startsWith('/api/my/') && !user) return err(401, 'Log in to create games');
    if (p === '/api/my/games' && method === 'GET') {
      return ok({ games: db.games().filter((g) => g.owner === user.id).sort((a, b) => b.updated - a.updated).map(summary) });
    }
    if (p === '/api/my/games' && method === 'POST') {
      if (db.games().filter((g) => g.owner === user.id).length >= 50) return err(400, 'You can have up to 50 games');
      let tpl = templates.find((t) => t.id === body?.template) || templates.find((t) => t.id === 'blank');
      const src = body?.from && db.game(String(body.from));
      if (src && (src.published || src.owner === user.id)) {
        const live = src.owner === user.id ? src : src.live;
        tpl = { id: src.template || 'remix', title: src.title, description: src.description, tags: src.tags, style: live.style, maxPlayers: live.maxPlayers, scripts: live.scripts, assets: live.assets };
      }
      const g = newGame(user.id, tpl, String(body?.title || '').trim().slice(0, 60) || (tpl.id === 'blank' ? 'Untitled Horror' : tpl.title + ' (Remix)'));
      db.data.games[g.id] = g;
      db.saveGame(g);
      return ok({ game: full(g) });
    }
    if ((r = m(/^\/api\/my\/games\/([\w-]+)(\/\w+)?$/))) {
      const g = db.game(r[1]);
      if (!g || g.owner !== user.id) return err(404, 'Game not found');
      const action = r[2];
      if (!action && method === 'GET') return ok({ game: full(g) });
      if (!action && method === 'PUT') {
        const e = await applyEdit(db, g, body || {});
        if (e) return err(400, e);
        db.saveGame(g);
        return ok({ game: full(g) });
      }
      if (!action && method === 'DELETE') { db.deleteGame(g.id); return ok({ ok: true }); }
      if (action === '/publish' && method === 'POST') {
        g.published = true;
        g.version += 1;
        g.publishedAt = Date.now();
        g.live = { scripts: structuredClone(g.scripts), assets: structuredClone(g.assets || []), style: g.style, maxPlayers: g.maxPlayers, version: g.version };
        db.saveGame(g);
        return ok({ game: full(g) });
      }
      if (action === '/unpublish' && method === 'POST') { g.published = false; db.saveGame(g); return ok({ game: full(g) }); }
    }
    return err(404, 'Unknown API route');
  }

  async function blobResponse(hash, cache) {
    const data = await db.getBlob(hash);
    if (!data) return { status: 404, json: { error: 'Not found' } };
    const comma = data.indexOf(',');
    return { status: 200, type: data.slice(5, data.indexOf(';')), bytes: base64ToBytes(data.slice(comma + 1)), cache };
  }

  function summary(g) {
    const owner = db.data.users[g.owner];
    return {
      id: g.id, title: g.title, description: g.description, tags: g.tags, style: g.style, maxPlayers: g.maxPlayers,
      creator: owner ? owner.name : 'unknown', official: g.owner === 'shiver', plays: g.plays, likes: g.likes.length,
      playing: rooms.playing(g.id), published: g.published, hasThumb: !!g.thumb, updated: g.updated, version: g.version, template: g.template,
    };
  }
  const full = (g) => ({ ...summary(g), scripts: g.scripts, assets: g.assets || [] });

  return { api, rooms, ready };
}

async function applyEdit(db, g, b) {
  if (typeof b.title === 'string') g.title = b.title.trim().slice(0, 60) || 'Untitled';
  if (typeof b.description === 'string') g.description = b.description.slice(0, 2000);
  if (Array.isArray(b.tags)) g.tags = b.tags.map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20)).filter(Boolean).slice(0, 6);
  if (STYLES.includes(b.style)) g.style = b.style;
  if (Number.isFinite(b.maxPlayers)) g.maxPlayers = Math.max(1, Math.min(16, Math.round(b.maxPlayers)));
  if (Array.isArray(b.scripts)) {
    if (b.scripts.length > LIMITS.scripts) return `Up to ${LIMITS.scripts} scripts per game`;
    let total = 0;
    const seen = new Set();
    for (const s of b.scripts) {
      if (!/^[\w-]{1,40}\.(host|client|shared)\.js$/.test(s?.name || '')) return `Bad script name "${s?.name}" (use name.host.js, name.client.js or name.shared.js)`;
      if (seen.has(s.name)) return `Two scripts are called ${s.name}`;
      seen.add(s.name);
      if (typeof s.code !== 'string' || s.code.length > LIMITS.scriptBytes) return `${s.name} is too big`;
      total += s.code.length;
    }
    if (total > LIMITS.totalBytes) return 'Scripts are too big in total';
    g.scripts = b.scripts.map((s) => ({ name: s.name, code: s.code }));
  }
  if (Array.isArray(b.assets)) {
    if (b.assets.length > LIMITS.assets) return `Up to ${LIMITS.assets} assets per game`;
    const out = [];
    const seen = new Set();
    for (const a of b.assets) {
      const name = String(a?.name || '');
      if (!/^[\w-]{1,32}$/.test(name) || seen.has(name)) return `Bad or duplicate asset name "${name}"`;
      seen.add(name);
      if (!/^[0-9a-f]{64}$/.test(a.hash || '') || !(await db.hasBlob(a.hash))) return `Asset "${name}" has not been uploaded`;
      const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
      out.push({
        name, hash: a.hash, kind: a.kind === 'sprite' ? 'sprite' : 'image',
        w: num(a.w, 1, 4096, 16), h: num(a.h, 1, 4096, 16), cols: num(a.cols, 1, 256, 1), rows: num(a.rows, 1, 256, 1),
        frames: (Array.isArray(a.frames) ? a.frames : [100]).slice(0, 1024).map((d) => num(d, 10, 10000, 100)),
        tags: (Array.isArray(a.tags) ? a.tags : []).slice(0, 64).map((t) => ({ name: String(t.name || 'tag').slice(0, 32), from: num(t.from, 0, 1023, 0), to: num(t.to, 0, 1023, 0), dir: ['forward', 'reverse', 'pingpong'].includes(t.dir) ? t.dir : 'forward' })),
        source: a.source === 'pixeter' ? 'pixeter' : 'image',
      });
    }
    g.assets = out;
  }
  if (typeof b.thumbnail === 'string') {
    if (!IMAGE_URL.test(b.thumbnail) || b.thumbnail.length > 400_000) return 'Thumbnail must be a small jpeg/png';
    g.thumb = await sha256(b.thumbnail);
    await db.putBlob(g.thumb, b.thumbnail);
  }
  g.updated = Date.now();
  return null;
}

function newGame(owner, tpl, title) {
  const now = Date.now();
  return {
    id: newId(8), owner, title, description: tpl.id === 'blank' ? '' : tpl.description || '', tags: [...(tpl.tags || [])],
    style: tpl.style || 'retro', maxPlayers: tpl.maxPlayers || 6, scripts: structuredClone(tpl.scripts), assets: structuredClone(tpl.assets || []), template: tpl.id,
    published: false, version: 0, live: null, plays: 0, likes: [], created: now, updated: now, publishedAt: 0, thumb: null,
  };
}

// The built-in games are published under the "shiver" account and refreshed from /templates on every start.
async function seedTemplates(db, templates) {
  if (!db.data.users.shiver) { db.data.users.shiver = { id: 'shiver', name: 'Shiver', created: Date.now() }; db.touch('users', 'shiver'); }
  for (const tpl of templates) {
    if (tpl.hidden) continue;
    const id = 'tpl-' + tpl.id;
    const g = db.data.games[id] || { ...newGame('shiver', tpl, tpl.title), id, plays: 0, likes: [] };
    const scriptsChanged = JSON.stringify(g.live?.scripts) !== JSON.stringify(tpl.scripts);
    Object.assign(g, { title: tpl.title, description: tpl.description, tags: tpl.tags, style: tpl.style, maxPlayers: tpl.maxPlayers, scripts: structuredClone(tpl.scripts), published: true, publishedAt: g.publishedAt || Date.now(), template: tpl.id });
    if (scriptsChanged || g.live?.style !== tpl.style) g.version += 1;
    g.live = { scripts: structuredClone(g.scripts), assets: [], style: g.style, maxPlayers: g.maxPlayers, version: g.version };
    if (tpl.thumbnail) { g.thumb = await sha256(tpl.thumbnail); await db.putBlob(g.thumb, tpl.thumbnail); }
    db.data.games[id] = g;
    db.saveGame(g);
  }
}

function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
