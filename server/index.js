// Shiver for Node: serves the platform, the sandboxed game runtime, the REST API and the WebSocket
// relay. Used by `./build.sh`, the Docker image and the desktop app. (cf/worker.js is the Cloudflare twin.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { createCore } from './core.js';
import { loadTemplates } from './templates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ts': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.map': 'application/json',
};
// URL prefix -> folder. Runtime + three.js get CORS because the game iframe runs on an opaque (sandboxed) origin.
const STATIC = [
  ['/web/', path.join(ROOT, 'web'), false],
  ['/runtime/', path.join(ROOT, 'runtime'), true],
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/build'), true],
  ['/vendor/monaco/', path.join(ROOT, 'node_modules/monaco-editor/min'), false],
];

// Creator code runs in the runtime page. No network access, so a game can't phone home with player data.
export function runtimeCSP(host) {
  const origin = `http://${host} https://${host}`;
  return [
    "default-src 'none'", `script-src ${origin} 'unsafe-eval' blob:`, `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data: blob:`, 'media-src data: blob:', "connect-src 'none'", `font-src ${origin} data:`, 'worker-src blob:',
  ].join('; ');
}

// Records in one JSON file, blobs (art, thumbnails) as one file each.
class FileStore extends Store {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'db.json');
    this.blobDir = path.join(dir, 'blobs');
    fs.mkdirSync(this.blobDir, { recursive: true });
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch {}
  }
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  async getBlob(hash) {
    try { return fs.readFileSync(path.join(this.blobDir, hash), 'utf8'); } catch { return null; }
  }
  async hasBlob(hash) { return fs.existsSync(path.join(this.blobDir, hash)); }
  async putBlob(hash, data) {
    const f = path.join(this.blobDir, hash);
    if (!fs.existsSync(f)) fs.writeFileSync(f, data);
  }
}

export async function startServer({ port = Number(process.env.PORT) || 8781, host = process.env.HOST || '0.0.0.0', dataDir = process.env.SHIVER_DATA || path.join(ROOT, 'data') } = {}) {
  const db = new FileStore(dataDir);
  const core = createCore({ db, templates: loadTemplates(path.join(ROOT, 'templates')) });
  await core.ready;
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.SHIVER_TURN_URL) ice.push({ urls: process.env.SHIVER_TURN_URL.split(','), username: process.env.SHIVER_TURN_USER, credential: process.env.SHIVER_TURN_PASS });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Server error' });
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : null;
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const r = await core.api({ method: req.method, path: p, query: url.searchParams, token, body, ice });
      if (r.bytes) {
        res.writeHead(r.status, { 'Content-Type': r.type, 'Content-Length': r.bytes.length, 'Cache-Control': r.cache || 'no-cache' });
        return res.end(Buffer.from(r.bytes));
      }
      return send(res, r.status, r.json);
    }
    for (const [prefix, dir, cors] of STATIC) {
      if (p.startsWith(prefix)) return serveFile(req, res, dir, p.slice(prefix.length), cors);
    }
    if (p === '/favicon.ico') return serveFile(req, res, path.join(ROOT, 'web'), 'icon.png');
    return serveFile(req, res, path.join(ROOT, 'web'), 'index.html'); // single-page app
  }

  function serveFile(req, res, dir, rel, cors) {
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, { error: 'Forbidden' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': dir.includes('node_modules') ? 'public, max-age=86400' : 'no-cache' };
      if (cors) headers['Access-Control-Allow-Origin'] = '*';
      if (dir.endsWith('runtime') && rel === 'runtime.html') headers['Content-Security-Policy'] = runtimeCSP(req.headers.host);
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });
  wss.on('connection', (ws) => {
    const conn = core.rooms.open((s) => ws.readyState === 1 && ws.send(s), () => ws.close());
    conn.ws = ws;
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (raw) => core.rooms.message(conn, String(raw)));
    ws.on('close', () => core.rooms.leave(conn));
    ws.on('error', () => {});
  });
  // drop players whose connection silently died
  const sweep = setInterval(() => {
    for (const r of core.rooms.rooms.values()) for (const c of r.players.values()) {
      if (!c.alive) { c.ws?.terminate(); continue; }
      c.alive = false;
      c.ws?.ping();
    }
  }, 30_000);
  sweep.unref();

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = server.address().port;
      console.log(`Shiver running at http://localhost:${actual}`);
      resolve({ server, port: actual, db, close: () => { db.flush(); clearInterval(sweep); wss.close(); server.close(); } });
    });
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { s.close(); process.exit(0); });
}
