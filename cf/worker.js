// Shiver on Cloudflare: static files come from Workers Assets; the API and the WebSocket rooms live
// in one Durable Object ("Hub") running the same core as the Node server, stored in its SQLite storage.
import { DurableObject } from 'cloudflare:workers';
import { createCore } from '../server/core.js';
import { Store } from '../server/store.js';
import TEMPLATES from './dist/templates.js';

// Same policy as server/index.js: creator code gets no network access.
function runtimeCSP(host) {
  const origin = `http://${host} https://${host}`;
  return [
    "default-src 'none'", `script-src ${origin} 'unsafe-eval' blob:`, `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data: blob:`, 'media-src data: blob:', "connect-src 'none'", `font-src ${origin} data:`, 'worker-src blob:',
  ].join('; ');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    if (url.pathname === '/runtime/runtime.html') {
      const res = await env.ASSETS.fetch(req);
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', runtimeCSP(url.host));
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(res.body, { status: res.status, headers });
    }
    return env.ASSETS.fetch(req);
  },
};

// Records are kept in memory and written through to Durable Object storage as "kind:id" keys.
class DOStore extends Store {
  constructor(storage) {
    super();
    this.storage = storage;
    this.dirty = new Set();
  }
  async load() {
    for (const kind of Object.keys(this.data)) {
      for (const [k, v] of await this.storage.list({ prefix: kind + ':' })) this.data[kind][k.slice(kind.length + 1)] = v;
    }
  }
  touch(kind, id) {
    this.dirty.add(kind + ':' + id);
    this.timer ||= setTimeout(() => this.flush(), 50);
  }
  async flush() {
    this.timer = null;
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const key of keys) {
      const i = key.indexOf(':');
      const value = this.data[key.slice(0, i)][key.slice(i + 1)];
      if (value === undefined) await this.storage.delete(key);
      else await this.storage.put(key, value);
    }
  }
  async getBlob(hash) { return (await this.storage.get('blob:' + hash)) ?? null; }
  async hasBlob(hash) { return (await this.storage.get('blob:' + hash)) != null; }
  async putBlob(hash, data) { if (!(await this.hasBlob(hash))) await this.storage.put('blob:' + hash, data); }
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new DOStore(ctx.storage);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      await this.store.load();
      this.core = createCore({ db: this.store, templates: TEMPLATES });
      await this.core.ready;
    });
  }

  async fetch(req) {
    await this.ready;
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const rooms = this.core.rooms;
      const conn = rooms.open((s) => { try { server.send(s); } catch {} }, () => server.close());
      server.addEventListener('message', (ev) => rooms.message(conn, typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)));
      server.addEventListener('close', () => rooms.leave(conn));
      server.addEventListener('error', () => rooms.leave(conn));
      return new Response(null, { status: 101, webSocket: client });
    }
    const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => null) : null;
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const r = await this.core.api({ method: req.method, path: url.pathname, query: url.searchParams, token, body });
    if (r.bytes) return new Response(r.bytes, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': r.cache || 'no-cache' } });
    return Response.json(r.json, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
