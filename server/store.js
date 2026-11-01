// Data store shared by the Node server and the Cloudflare Durable Object. Records live in memory;
// subclasses persist them (a JSON file on Node, Durable Object storage on Cloudflare).
// Big binary things (thumbnails, Pixeter art) are "blobs", addressed by their SHA-256 and loaded lazily.
const enc = new TextEncoder();
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const newId = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHA[b % 62]).join('');

export async function sha256(str) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}

export class Store {
  constructor() {
    this.data = { users: {}, sessions: {}, games: {} };
  }

  // ---- persistence hooks (overridden) ----
  touch(kind, id) {} // record data[kind][id] changed or was deleted
  async getBlob(hash) { return null; }
  async putBlob(hash, dataUrl) {}
  async hasBlob(hash) { return !!(await this.getBlob(hash)); }

  // ---- users ----
  userByName(name) {
    const lower = name.toLowerCase();
    return Object.values(this.data.users).find((u) => u.name.toLowerCase() === lower) || null;
  }

  async createUser(name, password) {
    const salt = newId(16);
    const user = { id: newId(), name, salt, pw: await pbkdf2(password, salt), created: Date.now() };
    this.data.users[user.id] = user;
    this.touch('users', user.id);
    return user;
  }

  async checkPassword(user, password) {
    if (!user.pw) return false;
    const a = await pbkdf2(password, user.salt), b = user.pw;
    let diff = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  newSession(userId) {
    const token = newId(40);
    this.data.sessions[token] = { userId, created: Date.now() };
    this.touch('sessions', token);
    return token;
  }

  userByToken(token) {
    const s = token && this.data.sessions[token];
    return s ? this.data.users[s.userId] || null : null;
  }

  // ---- games ----
  game(id) { return this.data.games[id] || null; }
  games() { return Object.values(this.data.games); }
  saveGame(g) { this.touch('games', g.id); }
  deleteGame(id) { delete this.data.games[id]; this.touch('games', id); }
}

export const publicUser = (u) => u && { id: u.id, name: u.name };
