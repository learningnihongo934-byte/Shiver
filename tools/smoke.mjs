// End-to-end smoke test for the server: accounts, studio, publishing, rooms and relaying.
// Also compiles every template script the same way the engine does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { loadTemplates } from '../server/templates.js';

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('  ok', msg); };

const AF = Object.getPrototypeOf(async function () {}).constructor;
for (const t of loadTemplates(path.resolve('templates'))) for (const s of t.scripts) {
  try { new AF(s.code); } catch (e) { ok(false, `${t.id}/${s.name} compiles: ${e.message}`); }
}
console.log('  ok all template scripts compile');

// SHIVER_URL=https://... runs the same checks against a deployed server (e.g. Cloudflare)
const remote = process.env.SHIVER_URL?.replace(/\/$/, '');
const dataDir = remote ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'shiver-test-'));
const srv = remote ? null : await startServer({ port: 0, host: '127.0.0.1', dataDir });
const base = remote || `http://127.0.0.1:${srv.port}`;
const wsBase = base.replace(/^http/, 'ws');
const uname = 'tester_' + Math.random().toString(36).slice(2, 8);
if (remote) console.log('  testing', remote);
const call = async (p, { method, body, token } = {}) => {
  const r = await fetch(base + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

let r = await call('/games');
ok(r.data.games.length >= 4, `front page lists ${r.data.games.length} built-in games`);
r = await call('/signup', { body: { name: uname, password: 'hunter22' } });
ok(r.status === 200 && r.data.token, 'sign up');
const token = r.data.token;
ok((await call('/signup', { body: { name: uname.toUpperCase(), password: 'xxxxxx' } })).status === 409, 'duplicate username rejected');
ok((await call('/login', { body: { name: uname, password: 'nope' } })).status === 401, 'wrong password rejected');
ok((await call('/login', { body: { name: uname, password: 'hunter22' } })).status === 200, 'log in');
r = await call('/my/games', { body: { template: 'the-ward', title: 'Smoke Ward' }, token });
ok(r.data.game?.scripts?.length >= 3, 'create game from template');
const gid = r.data.game.id;
r = await call('/my/games/' + gid, { method: 'PUT', body: { scripts: [{ name: 'bad name.js', code: '' }] }, token });
ok(r.status === 400, 'bad script name rejected');
r = await call('/my/games/' + gid, { method: 'PUT', body: { description: 'A smoke test ward.', style: 'noir' }, token });
ok(r.status === 200, 'save game');
ok((await call(`/games/${gid}`)).status === 404, 'unpublished game hidden');
r = await call(`/my/games/${gid}/publish`, { body: {}, token });
ok(r.data.game.published && r.data.game.version === 1, 'publish');
ok((await call(`/games/${gid}`)).status === 200, 'published game visible');
// Pixeter / image assets are stored by content hash
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
r = await call('/blobs', { body: { data: png }, token });
ok(/^[0-9a-f]{64}$/.test(r.data.hash), 'upload art blob');
const hash = r.data.hash;
ok((await call('/blobs', { body: { data: 'data:text/html;base64,PHNjcmlwdD4=' }, token })).status === 400, 'non-image blob rejected');
r = await call('/my/games/' + gid, { method: 'PUT', body: { assets: [{ name: 'creep', hash, kind: 'sprite', w: 1, h: 1, cols: 1, rows: 1, frames: [100], tags: [{ name: 'walk', from: 0, to: 0 }], source: 'pixeter' }] }, token });
ok(r.status === 200 && r.data.game.assets[0].tags[0].name === 'walk', 'save game with a Pixeter asset');
ok((await call('/my/games/' + gid, { method: 'PUT', body: { assets: [{ name: 'x', hash: 'f'.repeat(64) }] }, token })).status === 400, 'asset with unknown blob rejected');
const blobRes = await fetch(base + '/api/blob/' + hash);
ok(blobRes.status === 200 && blobRes.headers.get('content-type') === 'image/png', 'serve art blob as PNG');
r = await call(`/my/games/${gid}/publish`, { body: {}, token });
ok(r.data.game.version === 2, 'republish with assets');
r = await call('/my/games', { body: { from: 'tpl-fluorescent' }, token });
ok(r.data.game?.title.includes('Remix'), 'remix a game');
const remixId = r.data.game.id;

// two players join the same public room
const join = (name, extra = {}) => new Promise((resolve) => {
  const ws = new WebSocket(`${wsBase}/ws`);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', gameId: gid, name, ...extra })));
  const wait = (pred, ms = 2000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => { const m = msgs.find(pred); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout waiting')); } }, 10);
  });
  resolve({ ws, msgs, wait, send: (m) => ws.send(JSON.stringify(m)) });
});
const a = await join('Alice');
const wa = await a.wait((m) => m.t === 'welcome');
ok(wa.you === wa.host && wa.game.scripts.length >= 3, 'first player is host and gets scripts');
ok(wa.game.assets?.[0]?.hash === hash, 'room carries the asset list');
const b = await join('Bob');
const wb = await b.wait((m) => m.t === 'welcome');
ok(wb.code === wa.code && wb.host === wa.you, 'second player joins the same room');
await a.wait((m) => m.t === 'join' && m.pid === wb.you);
ok(true, 'host is told about the new player');
b.send({ t: 's', s: { p: [1, 2, 3], r: [0, 0] } });
await a.wait((m) => m.t === 's' && m.from === wb.you);
ok(true, 'player state relayed');
b.send({ t: 'n', to: 'host', name: '__i', data: { id: 's1' } });
await a.wait((m) => m.t === 'n' && m.name === '__i');
ok(true, 'client -> host message relayed');
a.send({ t: 'rtc', to: wb.you, data: { sdp: 'x' } });
await b.wait((m) => m.t === 'rtc');
ok(true, 'voice signaling relayed');
r = await call(`/games/${gid}`);
ok(r.data.game.playing === 2 && r.data.game.rooms.length === 1, 'room shows up as live with 2 players');
a.ws.close();
const hm = await b.wait((m) => m.t === 'host');
ok(hm.pid === wb.you, 'host migrates when the host leaves');
const c = await join('Carol', { code: wb.code });
ok((await c.wait((m) => m.t === 'welcome')).code === wb.code, 'join a room by code');
const bad = await join('Dan', { code: 'NOPE00' });
ok(/No room/.test((await bad.wait((m) => m.t === 'error')).error), 'unknown room code rejected');
const priv = await join('Eve', { private: true });
ok((await priv.wait((m) => m.t === 'welcome')).code !== wb.code, 'private room is separate');
const draft = await join('Mallory', { draft: true });
ok(/creator/.test((await draft.wait((m) => m.t === 'error')).error), 'only the creator can open a draft room');
for (const x of [b, c, bad, priv, draft]) x.ws.close();

// static files
for (const p of ['/', '/runtime/runtime.html', '/vendor/three/three.module.js', '/web/js/app.js', '/vendor/monaco/vs/loader.js', '/runtime/shiver.d.ts']) {
  const res = await fetch(base + p);
  ok(res.status === 200, `serves ${p}`);
}
const rt = await fetch(base + '/runtime/runtime.html');
ok(/connect-src 'none'/.test(rt.headers.get('content-security-policy')), 'game sandbox has no network access');

if (!remote) {
  srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
} else {
  for (const id of [gid, remixId]) await call('/my/games/' + id, { method: 'DELETE', token }); // tidy up test games
}
console.log('\nAll smoke tests passed.');
process.exit(0);
