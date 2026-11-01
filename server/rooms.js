// Game rooms. The server never runs creator code: one player in each room is the "host" whose
// browser runs the host scripts (monsters, rules). The server just relays and keeps things fair-ish.
// Platform-neutral: callers create a connection with open(send, close) and feed it message()/leave().
import { newId } from './store.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MSG_PER_SEC = 240;

export class Rooms {
  constructor(db) {
    this.db = db;
    this.rooms = new Map(); // roomId -> room
    this.byCode = new Map();
  }

  // send(string) delivers to the client, close() hangs up.
  open(send, close) {
    return { send, close, pid: null, room: null, name: null, user: null, budget: MSG_PER_SEC, last: Date.now(), alive: true };
  }

  message(conn, raw) {
    const now = Date.now();
    conn.budget = Math.min(MSG_PER_SEC, conn.budget + ((now - conn.last) / 1000) * MSG_PER_SEC);
    conn.last = now;
    if (--conn.budget < 0) return; // flooding: drop
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { this.onMessage(conn, msg); } catch (e) { console.error('room message error', e); }
  }

  onMessage(conn, msg) {
    if (msg.t === 'join') return this.join(conn, msg);
    const room = conn.room;
    if (!room) return;
    switch (msg.t) {
      case 's': // player state, relayed to everyone else
        this.broadcast(room, { t: 's', from: conn.pid, s: msg.s }, conn.pid);
        break;
      case 'n': { // script / engine message
        const out = { t: 'n', from: conn.pid, name: String(msg.name).slice(0, 64), data: msg.data };
        if (msg.to === 'host') this.sendTo(room, room.host, out);
        else if (msg.to === 'others') this.broadcast(room, out, conn.pid);
        else if (msg.to === 'all') this.broadcast(room, out);
        else this.sendTo(room, String(msg.to), out);
        break;
      }
      case 'rtc': // WebRTC signaling for voice chat
        this.sendTo(room, String(msg.to), { t: 'rtc', from: conn.pid, data: msg.data });
        break;
      case 'chat': {
        const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (text) this.broadcast(room, { t: 'chat', from: conn.pid, name: conn.name, text });
        break;
      }
      case 'lock': // host can stop new players joining mid-round
        if (conn.pid === room.host) room.locked = !!msg.locked;
        break;
      case 'ping':
        conn.send(JSON.stringify({ t: 'pong' }));
        break;
    }
  }

  join(conn, msg) {
    if (conn.room) return;
    const user = this.db.userByToken(msg.token);
    conn.user = user;
    conn.name = user ? user.name : cleanName(msg.name) || 'Guest' + Math.floor(1000 + Math.random() * 9000);
    const fail = (error) => conn.send(JSON.stringify({ t: 'error', error }));

    let room = null;
    if (msg.code) {
      room = this.byCode.get(String(msg.code).toUpperCase());
      if (!room) return fail('No room with that code. It may have ended.');
    } else {
      const g = this.db.game(String(msg.gameId));
      if (!g) return fail('Game not found');
      if (msg.draft) {
        if (!user || g.owner !== user.id) return fail('Only the creator can test a draft');
        room = this.create(g, { scripts: g.scripts, assets: g.assets || [], style: g.style, maxPlayers: g.maxPlayers, version: 'draft' }, true);
      } else {
        if (!g.published || !g.live) return fail('This game is not published');
        if (!msg.private) {
          room = [...this.rooms.values()].find((r) => r.gameId === g.id && !r.private && !r.locked && r.version === g.live.version && r.players.size < r.maxPlayers);
        }
        room ||= this.create(g, g.live, !!msg.private);
        g.plays += 1;
        this.db.saveGame(g);
      }
    }
    if (room.players.size >= room.maxPlayers) return fail('That room is full');
    if (room.locked) return fail('That round already started');

    conn.pid = 'p' + ++room.counter;
    conn.room = room;
    room.players.set(conn.pid, conn);
    if (!room.host) room.host = conn.pid;
    const game = this.db.game(room.gameId);
    conn.send(JSON.stringify({
      t: 'welcome', you: conn.pid, name: conn.name, host: room.host, code: room.code, seed: room.seed,
      players: [...room.players.values()].map((c) => ({ pid: c.pid, name: c.name })),
      game: { id: room.gameId, title: game?.title || 'Game', style: room.style, maxPlayers: room.maxPlayers, scripts: room.scripts, assets: room.assets, version: room.version, draft: room.version === 'draft' },
    }));
    this.broadcast(room, { t: 'join', pid: conn.pid, name: conn.name }, conn.pid);
  }

  create(g, live, isPrivate) {
    let code;
    do code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    while (this.byCode.has(code));
    const room = {
      id: newId(), code, gameId: g.id, private: isPrivate, scripts: live.scripts, assets: live.assets || [], style: live.style, maxPlayers: live.maxPlayers,
      version: live.version, seed: Math.floor(Math.random() * 2 ** 31), players: new Map(), host: null, counter: 0, created: Date.now(), locked: false,
    };
    this.rooms.set(room.id, room);
    this.byCode.set(code, room);
    return room;
  }

  leave(conn) {
    const room = conn.room;
    if (!room) return;
    room.players.delete(conn.pid);
    conn.room = null;
    if (room.players.size === 0) {
      this.rooms.delete(room.id);
      this.byCode.delete(room.code);
      return;
    }
    this.broadcast(room, { t: 'leave', pid: conn.pid });
    if (room.host === conn.pid) {
      room.host = room.players.keys().next().value;
      room.locked = false;
      this.broadcast(room, { t: 'host', pid: room.host });
    }
  }

  sendTo(room, pid, msg) {
    const c = room.players.get(pid);
    if (c) try { c.send(JSON.stringify(msg)); } catch {}
  }

  broadcast(room, msg, except) {
    const s = JSON.stringify(msg);
    for (const c of room.players.values()) if (c.pid !== except) try { c.send(s); } catch {}
  }

  playing(gameId) {
    let n = 0;
    for (const r of this.rooms.values()) if (r.gameId === gameId && r.version !== 'draft') n += r.players.size;
    return n;
  }

  hasRoom(gameId) {
    for (const r of this.rooms.values()) if (r.gameId === gameId) return true;
    return false;
  }

  onlineCount() {
    let n = 0;
    for (const r of this.rooms.values()) n += r.players.size;
    return n;
  }

  publicRooms(gameId) {
    return [...this.rooms.values()]
      .filter((r) => r.gameId === gameId && !r.private)
      .map((r) => ({ code: r.code, players: r.players.size, max: r.maxPlayers, locked: r.locked, names: [...r.players.values()].map((c) => c.name) }));
  }
}

function cleanName(n) {
  return String(n || '').replace(/[^\w ]/g, '').trim().slice(0, 20);
}
