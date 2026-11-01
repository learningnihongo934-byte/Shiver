// Shiver engine core. Runs inside a sandboxed iframe; the platform page (parent) owns the network
// socket, the microphone and voice chat, and talks to us only through postMessage.
import * as THREE from '/vendor/three/three.module.js';
import { Renderer } from './render.js';
import { World } from './world.js';
import { Controller, Avatars, ignoreNonSolid } from './player.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { setSmoothTextures, tickTextures, setAssets } from './textures.js';
import { createModel } from './models.js';
import { buildApi } from './api.js';
import { Cinematic } from './cinematic.js';

const parentPost = (msg) => parent.postMessage(msg, '*');
const STATE_HZ = 15;
const DEFAULT_CONFIG = {
  walkSpeed: 3.2, sprintSpeed: 5.8, crouchSpeed: 1.5, jump: true, sprint: true, stamina: true, flashlight: true, battery: true,
  batterySeconds: 300, ghosts: true, ghostsVisible: false, voice: 'proximity', voiceRange: 22, nameTags: true, micSensitivity: 1,
  camera: 'first', respawn: false, friendlyFire: false,
};

class Events {
  constructor(engine) { this.engine = engine; this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.map.get(name)?.delete(fn);
  }
  emit(name, ...args) {
    const set = this.map.get(name);
    if (set) for (const fn of [...set]) this.engine.safe(fn, `on('${name}')`, ...args);
  }
  clear() { this.map.clear(); }
}

// One record per player in the room. Movement fields come from that player's own client; the
// "pstate" fields (alive, role, inventory...) are owned by the host and replicated to everyone.
const PSTATE_KEYS = ['alive', 'role', 'inv', 'data', 'speed', 'model', 'voice', 'team', 'color', 'vision', 'visible', 'score'];
class PlayerRec {
  constructor(id, name, isMe) {
    this.id = id;
    this.name = name;
    this.isMe = isMe;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.crouch = false;
    this.light = false;
    this.hidden = false;
    this.tx = false;
    this.noise = 0;
    this.speaking = 0;
    this.lastState = 0;
    this.alive = true;
    this.role = 'survivor';
    this.inv = [];
    this.data = {};
    this.speed = 1;
    this.model = 'humanoid';
    this.voice = null;
    this.team = null;
    this.vision = null;
    this.visible = true;
    this.score = 0;
    const hue = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 3) % 360;
    this.color = new THREE.Color().setHSL(hue / 360, 0.35, 0.35).getHex();
  }
  pstate() { return Object.fromEntries(PSTATE_KEYS.map((k) => [k, this[k]])); }
}

class Engine {
  constructor() {
    this.renderer = new Renderer(document.getElementById('root'));
    this.events = new Events(this);
    this.audio = new Audio();
    this.world = new World(this);
    this.ui = new UI(this);
    this.player = new Controller(this);
    this.avatars = new Avatars(this);
    this.cine = new Cinematic(this);
    this.players = new Map();
    this.netHandlers = new Map();
    this.mic = { level: 0, muted: false, enabled: false };
    this.config = { ...DEFAULT_CONFIG };
    this.time = 0;
    this.started = false;
    this.isHost = false;
    this.spawnPoints = [];
    this.gameState = {};
    this.stateWatchers = new Map();
    this.errors = 0;
    this.lastState = 0;
    this.lastMix = 0;
    this.myVoice = 'none';
    this.holdT = 0;
    this.hauntCooldown = 0;
    this.roundId = 0;
    addEventListener('message', (e) => e.source === parent && this.onParent(e.data));
    this.hookConsole();
    this.ui.showOverlay('<div class="boot">LOADING…</div>', 'boot');
    parentPost({ t: 'ready' });
  }

  // ------------------------------------------------------------------ parent bridge
  onParent(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'init': return this.init(m);
      case 'state': return this.onState(m.from, m.s);
      case 'net': return this.onNet(m.from, m.name, m.data);
      case 'join': return this.onJoin(m.pid, m.name);
      case 'leave': return this.onLeave(m.pid);
      case 'host': return this.onHostChange(m.pid);
      case 'chat': {
        const p = this.players.get(m.from);
        const ghost = p && !p.alive && this.me?.alive;
        if (ghost && this.config.ghostChat !== true) return; // the living can't read the dead
        this.ui.chat(m.name + (p && !p.alive ? ' 👻' : ''), m.text, p ? '#' + new THREE.Color(p.color).offsetHSL(0, 0.2, 0.3).getHexString() : null);
        return this.events.emit('chat', this.handle(p), m.text);
      }
      case 'mic': Object.assign(this.mic, { level: m.level, muted: m.muted, enabled: m.enabled }); return;
      case 'speaking': for (const [pid, lv] of Object.entries(m.levels || {})) { const p = this.players.get(pid); if (p) p.speaking = lv; } return;
      case 'capture': return parentPost({ t: 'thumbnail', data: this.renderer.capture() });
      case 'record': return m.on ? this.cine.record(m) : this.cine.stopRecording();
      case 'settings': if (m.sensitivity) this.player.sensitivity = m.sensitivity; if (m.volume != null) this.audio.setVolume(m.volume); return;
    }
  }

  post(m) { parentPost(m); }

  init(m) {
    if (this.inited) return;
    this.inited = true;
    this.game = m.game;
    this.mode = m.mode; // 'online' | 'solo'
    this.myId = m.you;
    this.hostId = m.host;
    this.isHost = m.host === m.you;
    this.seed = m.seed >>> 0;
    this.code = m.code;
    if (m.settings?.sensitivity) this.player.sensitivity = m.settings.sensitivity;
    for (const p of m.players || []) this.players.set(p.pid, new PlayerRec(p.pid, p.name, p.pid === m.you));
    if (!this.players.has(m.you)) this.players.set(m.you, new PlayerRec(m.you, m.name || 'You', true));
    this.me = this.players.get(m.you);
    setAssets(m.game.assets);
    this.renderer.setStyle(m.game.style || 'retro');
    setSmoothTextures(this.renderer.style.height === 0 || this.renderer.style.height > 400);
    this.ui.setStamp(!!this.renderer.style.stamp);
    this.compileScripts();
    this.startRound();
    const help = this.config.movie ? 'A Shiver film · Space to continue · Esc to skip' : `WASD move · Mouse look · Shift sprint · C crouch · F flashlight · E interact · T chat · Tab players · M mute${this.hasRadio() ? ' · R radio' : ''}`;
    this.ui.showOverlay(`<div class="start"><h1>${esc(m.game.title)}</h1><p>${this.config.movie ? 'Click to watch' : 'Click to play'}</p><small>${help}</small></div>`, 'start');
    this.ui.overlay.onclick = () => this.begin();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    this.keepAliveInBackground();
  }

  begin() {
    this.audio.resume();
    this.started = true;
    this.ui.hideOverlay();
    this.ui.overlay.onclick = null;
    if (this.config.movie) { this.ui.hideHud(true); this.player.frozen = true; this.player.noLock = true; }
    this.player.lockPointer();
    this.events.emit('begin');
  }

  onPointerLock(locked) {
    if (locked || !this.started || this.ui.chatOpen || this.ui.noteOpen || this.player.cameraMode === 'topdown' || this.ended) return;
    this.ui.showOverlay(`<div class="pause"><h2>Paused</h2><button data-a="resume">Resume</button><button data-a="leave">Leave game</button><small>Room ${esc(this.code || 'solo')}</small></div>`, 'pause');
    this.ui.overlay.onclick = (e) => {
      const a = e.target.dataset?.a;
      if (a === 'leave') parentPost({ t: 'leave' });
      else if (a === 'resume' || e.target === this.ui.overlay) { this.ui.hideOverlay(); this.player.lockPointer(); }
    };
  }

  // ------------------------------------------------------------------ scripts
  compileScripts() {
    this.scripts = [];
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const s of this.game.scripts || []) {
      const kind = s.name.match(/\.(host|client|shared)\.js$/)?.[1] || 'shared';
      try {
        const names = Object.keys(buildApi(this, kind, s.name));
        const fn = new AsyncFunction(...names, `"use strict";\n${s.code}\n//# sourceURL=${s.name}`);
        this.scripts.push({ name: s.name, kind, fn, names });
      } catch (err) {
        this.reportError(err, s.name, true);
      }
    }
  }

  runScripts() {
    const order = { shared: 0, host: 1, client: 2 };
    const list = this.scripts.filter((s) => s.kind !== 'host' || this.isHost).sort((a, b) => order[a.kind] - order[b.kind]);
    for (const s of list) {
      const api = buildApi(this, s.kind, s.name);
      try {
        const p = s.fn(...s.names.map((n) => api[n]));
        p.catch((err) => this.reportError(err, s.name));
      } catch (err) {
        this.reportError(err, s.name);
      }
    }
  }

  // Wipes the world and runs every script again (round restart / host migration).
  startRound() {
    this.roundId++;
    this.events.clear();
    this.netHandlers.clear();
    this.stateWatchers.clear();
    this.cine.reset();
    this.world.clear();
    this.audio.stopAll();
    this.ui.clearCustom();
    this.ui.hideOverlay();
    this.ended = false;
    this.gameState = {};
    this.spawnPoints = [];
    this.config = { ...DEFAULT_CONFIG };
    this.renderer.effects.fade = 0;
    this.renderer.effects.fadeTarget = 0;
    this.renderer.effects.thermal = 0;
    this.renderer.effects.damage = 0;
    this.renderer.fogLocked = false;
    this.renderer.setStyle(this.game.style || 'retro');
    this.renderer.scene.fog.color.set(0x020203);
    this.renderer.scene.background.set(0x020203);
    this.renderer.hemi.intensity = 0.08;
    this.renderer.moon.intensity = 0;
    for (const p of this.players.values()) Object.assign(p, { alive: true, role: 'survivor', inv: [], data: {}, speed: 1, model: 'humanoid', voice: null, team: null, vision: null, visible: true, score: 0 });
    Object.assign(this.player, { battery: 1, stamina: 1, light: false, hidden: null, frozen: false, lookTarget: null });
    this.ui.setLocker(false);
    this.ui.setGhost(false);
    this.player.setMode('first');
    this.runScripts();
    this.respawnMe();
    this.events.emit('start');
  }

  safe(fn, where, ...args) {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((err) => this.reportError(err, where));
      return r;
    } catch (err) {
      this.reportError(err, where);
    }
  }

  reportError(err, where, compile) {
    if (err?.name === 'StaleRound') return;
    if (++this.errors > 200) return;
    const stack = String(err?.stack || err);
    const m = stack.match(/([\w-]+\.(?:host|client|shared)\.js):(\d+):(\d+)/);
    const line = m ? Math.max(1, Number(m[2]) - (compile ? 0 : this.lineOffset())) : null;
    parentPost({ t: 'log', level: 'error', text: `${err?.message || err}`, script: m?.[1] || where, line });
    if (this.errors < 4) this.ui.toast(`Script error: ${err?.message || err}`, 5, '#ff6060');
  }

  lineOffset() {
    // AsyncFunction adds wrapper lines + our "use strict" line; measure it once.
    if (this._lo != null) return this._lo;
    try {
      const AF = Object.getPrototypeOf(async function () {}).constructor;
      new AF('"use strict";\nthrow new Error("x")\n//# sourceURL=probe.shared.js')().catch((e) => {
        const m = String(e.stack).match(/probe\.shared\.js:(\d+)/);
        this._lo = m ? Number(m[1]) - 1 : 2;
      });
    } catch {}
    return this._lo ?? 3;
  }

  hookConsole() {
    for (const level of ['log', 'warn', 'error', 'info']) {
      const orig = console[level].bind(console);
      console[level] = (...a) => {
        orig(...a);
        parentPost({ t: 'log', level, text: a.map(fmt).join(' ') });
      };
    }
    addEventListener('error', (e) => this.reportError(e.error || e.message, 'runtime'));
    addEventListener('unhandledrejection', (e) => this.reportError(e.reason, 'promise'));
    this.lineOffset();
  }

  // ------------------------------------------------------------------ players
  handle(rec) {
    return rec ? (rec._handle ||= makePlayerHandle(this, rec)) : null;
  }

  setPState(rec, patch, quiet) {
    // host only: change authoritative player state and replicate it
    Object.assign(rec, patch);
    if (rec.isMe) this.applyMyPState(patch);
    if (!quiet) this.sendNet('others', '__ps', { id: rec.id, p: patch });
  }

  applyMyPState(patch) {
    if ('alive' in patch) {
      if (!patch.alive) this.onMyDeath();
      else { this.ui.setGhost(false); this.respawnMe(); }
    }
    if ('vision' in patch) this.renderer.effects.thermal = this.me.vision === 'thermal' ? 0.85 : 0;
    this.player.updateBody();
  }

  onMyDeath() {
    const p = this.player;
    p.light = false;
    p.hidden = null;
    this.ui.setLocker(false);
    this.renderer.effects.damage = 0.8;
    setTimeout(() => (this.renderer.effects.damage = 0), 1800);
    if (this.config.ghosts) {
      setTimeout(() => {
        if (this.me.alive) return;
        this.ui.setGhost(true);
        this.ui.toast('You died. Now haunt them.', 4, '#a8c0ff');
        this.renderer.effects.fade = 0;
        p.pos.y += 1;
      }, 1500);
    }
  }

  respawnMe() {
    const sp = this.spawnPoints.length ? this.spawnPoints[(Number(this.myId?.slice(1)) || 0) % this.spawnPoints.length] : { x: 0, y: 0.1, z: 0, yaw: 0 };
    this.player.pos.set(sp.x, sp.y ?? 0.1, sp.z);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = sp.yaw ?? 0;
    this.player.pitch = 0;
  }

  onJoin(pid, name) {
    if (this.players.has(pid)) return;
    const rec = new PlayerRec(pid, name, false);
    this.players.set(pid, rec);
    this.ui.toast(`${name} joined`, 2.5);
    if (this.isHost) {
      // late joiner: send the full world + player states + shared game state
      const ents = [...this.world.entities.values()].filter((e) => e.net && !e.remote && !e.shared).map((e) => this.world.spec(e));
      const ps = Object.fromEntries([...this.players.values()].map((p) => [p.id, p.pstate()]));
      const sp = Object.fromEntries(this.world.sharedPatches);
      this.sendNet(pid, '__snap', { ents, ps, gs: this.gameState, sp, sr: [...this.world.sharedRemoved] });
    }
    this.events.emit('playerJoin', this.handle(rec));
  }

  onLeave(pid) {
    const rec = this.players.get(pid);
    if (!rec) return;
    this.players.delete(pid);
    this.ui.toast(`${rec.name} left`, 2.5);
    this.events.emit('playerLeave', this.handle(rec));
  }

  onHostChange(pid) {
    const wasHost = this.isHost;
    this.hostId = pid;
    this.isHost = pid === this.myId;
    if (this.isHost && !wasHost) {
      this.ui.toast('The host left. You are the host now — restarting the round.', 4);
      this.sendNet('others', '__restart', {});
      this.startRound();
    }
  }

  onState(from, s) {
    const p = this.players.get(from);
    if (!p || !s) return;
    p.pos.set(s.p[0], s.p[1], s.p[2]);
    p.yaw = s.r[0];
    p.pitch = s.r[1];
    p.crouch = !!s.c;
    p.light = !!s.l;
    p.hidden = !!s.h;
    p.tx = !!s.tx;
    p.noise = s.n || 0;
    p.lastState = this.time;
    if (this.isHost && p.noise > 0.3 && (p.lastNoiseEvt ?? -9) < this.time - 0.5) {
      p.lastNoiseEvt = this.time;
      this.events.emit('noise', this.handle(p), p.noise);
    }
  }

  sendState() {
    const p = this.player;
    const me = this.me;
    me.pos.copy(p.pos);
    me.yaw = p.yaw;
    me.pitch = p.pitch;
    me.crouch = p.crouch;
    me.light = p.light;
    me.hidden = !!p.hidden;
    me.noise = p.noise;
    me.tx = this.hasRadio() && p.keys.has('KeyR') && !this.ui.chatOpen;
    if (this.mode !== 'online') return;
    parentPost({ t: 'state', s: { p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], r: [r2(p.yaw), r2(p.pitch)], c: p.crouch ? 1 : 0, l: p.light ? 1 : 0, h: p.hidden ? 1 : 0, tx: me.tx ? 1 : 0, n: r2(p.noise) } });
  }

  hasRadio() { return this.me?.inv?.some((i) => /radio|walkie/i.test(i)); }

  // ------------------------------------------------------------------ messaging
  // to: 'host' | 'others' | 'all' | pid. Messages addressed to ourselves are delivered locally.
  sendNet(to, name, data) {
    const toSelf = to === 'all' || to === this.myId || (to === 'host' && this.isHost);
    if (toSelf) queueMicrotask(() => this.onNet(this.myId, name, data));
    if (this.mode !== 'online') return;
    const remote = to === 'all' ? 'others' : to;
    if (remote === this.myId || (remote === 'host' && this.isHost)) return;
    parentPost({ t: 'net', to: remote, name, data });
  }

  onNet(from, name, data) {
    const sender = this.players.get(from);
    const fromHost = from === this.hostId;
    if (name.startsWith('__')) return this.onEngineMsg(from, sender, fromHost, name, data);
    const set = this.netHandlers.get(name);
    if (set) for (const fn of [...set]) this.safe(fn, `net.on('${name}')`, data, this.handle(sender));
  }

  onEngineMsg(from, sender, fromHost, name, d) {
    // host -> clients
    if (fromHost && from !== this.myId) {
      switch (name) {
        case '__w': return this.world.applyNet(d);
        case '__snap':
          this.world.clear((e) => e.net && !e.shared);
          this.world.applyNet({ s: d.ents, u: d.sp || {}, r: d.sr || [] }, 'snapshot');
          for (const [id, ps] of Object.entries(d.ps || {})) { const p = this.players.get(id); if (p) { Object.assign(p, ps); if (p.isMe) this.applyMyPState(ps); } }
          for (const [k, v] of Object.entries(d.gs || {})) this.setLocalState(k, v);
          return;
        case '__ps': {
          const p = this.players.get(d.id);
          if (!p) return;
          Object.assign(p, d.p);
          if (p.isMe) this.applyMyPState(d.p);
          return;
        }
        case '__gs': return this.setLocalState(d.k, d.v);
        case '__restart': return this.startRound();
      }
    }
    // commands the host sends to one player (or our own scripts send to us)
    if (fromHost || from === this.myId) {
      switch (name) {
        case '__cmd': return this.runCommand(d.c, d.a || []);
        case '__end': return this.showEnd(d);
        case '__fx': return this.runFx(d);
      }
    }
    // client -> host requests
    if (this.isHost && sender) {
      const h = this.handle(sender);
      switch (name) {
        case '__i': {
          const ent = this.world.entities.get(d.id);
          if (!ent || !ent.props.prompt || !sender.alive) return;
          if (sender.pos.distanceTo(ent.obj.position) > (ent.props.range ?? 2.5) + 2.5) return;
          ent.emit('interact', h);
          this.events.emit('interact', h, ent);
          return;
        }
        case '__haunt': {
          if (sender.alive || !this.config.ghosts) return;
          const ent = this.world.entities.get(d.id);
          if (ent?.kind === 'light') { ent.set({ burst: (ent.props.burst || 0) + 1 }); this.fxAll({ sound: 'whisper', pos: ent.props.pos, volume: 0.8 }); }
          this.events.emit('haunt', h, ent || null);
          return;
        }
        case '__attack': return this.events.emit('attack', h, d);
      }
    }
  }

  runCommand(c, a) {
    const p = this.player;
    a = a.map((x) => (x === null ? undefined : x)); // JSON turns missing args into null; let defaults apply
    switch (c) {
      case 'toast': return this.ui.toast(...a);
      case 'subtitle': return this.ui.subtitle(...a);
      case 'note': if (document.pointerLockElement) document.exitPointerLock(); return this.ui.note(...a);
      case 'objective': return this.ui.objective(...a);
      case 'teleport': p.pos.set(a[0], a[1], a[2]); p.vel.set(0, 0, 0); if (a[3] != null) p.yaw = a[3]; return;
      case 'jumpscare': return this.jumpscare(a[0], a[1]);
      case 'shake': p.shake = Math.max(p.shake, a[0] ?? 1); return;
      case 'fade': this.renderer.effects.fadeTarget = a[0]; this.renderer.effects.fadeSpeed = 1 / Math.max(0.05, a[1] ?? 1); return;
      case 'flash': return this.renderer.flash(a[0], a[1]);
      case 'sound': return this.audio.play(a[0], a[1] || {});
      case 'freeze': p.frozen = !!a[0]; return;
      case 'battery': p.battery = Math.min(1, p.battery + (a[0] ?? 1)); return;
      case 'stamina': p.stamina = Math.min(1, a[0] ?? 1); return;
      case 'unhide': return this.unhide();
      case 'hideIn': { const l = this.world.entities.get(a[0]); if (l) this.hide(l); return; }
      case 'cutscene': return this.cine.play(a[0], a[1] || {});
      case 'msg': {
        const set = this.netHandlers.get(a[0]);
        if (set) for (const fn of [...set]) this.safe(fn, `net.on('${a[0]}')`, a[1], this.handle(this.players.get(this.hostId)));
        return;
      }
    }
  }

  // Effects every client should see/hear (sounds at a position, flashes...)
  fxAll(d) { this.sendNet('all', '__fx', d); }
  runFx(d) {
    if (d.sound) this.audio.play(d.sound, { pos: d.pos ? new THREE.Vector3(...d.pos) : undefined, volume: d.volume, pitch: d.pitch, range: d.range });
    if (d.music !== undefined) this.audio.music(d.music, d.volume);
    if (d.flash) this.renderer.flash(d.flash, d.amount ?? 0.8);
    if (d.shake) this.player.shake = Math.max(this.player.shake, d.shake);
    if (d.glitch) this.renderer.effects.glitch = d.glitch;
  }

  setLocalState(k, v) {
    this.gameState[k] = v;
    const set = this.stateWatchers.get(k);
    if (set) for (const fn of [...set]) this.safe(fn, `state.watch('${k}')`, v);
  }

  sendChat(text) {
    if (this.mode === 'online') parentPost({ t: 'chat', text });
    else this.onParent({ t: 'chat', from: this.myId, name: this.me.name, text });
  }

  showEnd(d) {
    this.ended = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const again = this.isHost ? '<button data-a="again">Play again</button>' : '<small>Waiting for the host…</small>';
    this.ui.showOverlay(`<div class="end ${d.win ? 'win' : 'lose'}"><h1>${esc(d.title || 'The End')}</h1><p>${esc(d.text || '')}</p>${again}<button data-a="leave">Leave</button></div>`, 'end');
    this.ui.overlay.onclick = (e) => {
      const a = e.target.dataset?.a;
      if (a === 'leave') parentPost({ t: 'leave' });
      if (a === 'again' && this.isHost) { this.sendNet('others', '__restart', {}); this.startRound(); this.begin(); }
    };
    this.events.emit('end', d);
  }

  // ------------------------------------------------------------------ jumpscares
  jumpscare(model = 'stalker', o) {
    o ||= {};
    const cam = this.renderer.camera;
    const m = createModel(model, {});
    m.traverse((x) => { if (x.material) { x.material = x.material.clone(); x.material.fog = false; } });
    const holder = new THREE.Group();
    holder.add(m);
    const headY = m.userData.head ? m.userData.head.position.y : 1.6;
    m.position.set(0, -headY, 0);
    m.rotation.y = Math.PI;
    cam.add(holder);
    const light = new THREE.PointLight(o.color ?? 0xff3020, 6, 3, 1);
    light.position.set(0, 0.2, -0.3);
    cam.add(light);
    this.audio.play(o.sound || 'jumpscare', { volume: 1.4 });
    this.player.shake = 1.4;
    this.renderer.effects.glitch = 1;
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 1000;
      holder.position.set((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, -Math.max(0.35, 1.6 - t * 7));
      m.userData.animate?.(t * 3, { speed: 6, dt: 0.016 });
      if (t < (o.duration ?? 1.1)) requestAnimationFrame(step);
      else { cam.remove(holder, light); this.renderer.flash(0x000000, 1); }
    };
    step();
  }

  // ------------------------------------------------------------------ interaction
  findInteractable() {
    const cam = this.renderer.camera;
    const origin = cam.position;
    const dir = this.player.cameraMode === 'first' ? cam.getWorldDirection(new THREE.Vector3()) : this.player.forward();
    const from = this.player.cameraMode === 'first' ? origin : this.player.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    let best = null, bestScore = Infinity;
    const c = new THREE.Vector3();
    for (const e of this.world.interactables) {
      if (!e.obj.visible || (e.props.who && e.props.who !== (this.me.alive ? 'alive' : 'dead'))) continue;
      e.center(c);
      const to = c.clone().sub(from);
      const dist = to.length();
      const range = (e.props.range ?? 2.5) + (this.player.cameraMode === 'topdown' ? 1 : 0);
      if (dist > range) continue;
      const ang = to.normalize().angleTo(dir);
      if (ang > (this.player.cameraMode === 'topdown' ? 1.2 : 0.45)) continue;
      const hit = this.world.raycast(from, to, dist, (x) => x === e || ignoreNonSolid(x) || x.kind === 'door' && x === e);
      if (hit && hit.entity !== e && hit.distance < dist - 0.3) continue;
      const score = ang * 3 + dist * 0.3;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  updateInteraction(dt) {
    const p = this.player;
    if (!this.started || this.ended || this.ui.chatOpen) return this.ui.prompt('');
    if (this.ui.noteOpen) {
      if (p.wasPressed('KeyE') || p.wasPressed('Escape')) { this.ui.closeNote(); p.lockPointer(); }
      return this.ui.prompt('');
    }
    if (p.hidden) {
      this.ui.prompt('[E] Leave hiding spot');
      if (p.wasPressed('KeyE')) this.unhide();
      return;
    }
    if (!this.me.alive) {
      // ghosts can haunt lights
      if (!this.config.ghosts) return this.ui.prompt('');
      let near = null, nd = 4;
      for (const e of this.world.entities.values()) if (e.kind === 'light' && e.net) { const d = e.obj.position.distanceTo(p.pos); if (d < nd) { nd = d; near = e; } }
      this.hauntCooldown -= dt;
      this.ui.prompt(near ? (this.hauntCooldown > 0 ? `Haunt recharging… ${Math.ceil(this.hauntCooldown)}` : '[E] Haunt this light') : '');
      if (near && p.wasPressed('KeyE') && this.hauntCooldown <= 0) { this.hauntCooldown = 6; this.sendNet('host', '__haunt', { id: near.id }); this.audio.play('whisper', { volume: 0.4 }); }
      return;
    }
    const target = this.findInteractable();
    const hold = target?.props.hold || 0;
    if (!target) { this.holdT = 0; return this.ui.prompt(''); }
    if (hold > 0) {
      if (p.keys.has('KeyE')) {
        this.holdT += dt;
        p.extraNoise = Math.max(p.extraNoise, target.props.holdNoise ?? 0.35);
        if (this.holdT >= hold) { this.holdT = 0; this.interact(target); }
      } else this.holdT = 0;
      this.ui.prompt(`[Hold E] ${target.props.prompt}`, this.holdT / hold);
    } else {
      this.ui.prompt(`[E] ${target.props.prompt}`);
      if (p.wasPressed('KeyE')) this.interact(target);
    }
  }

  interact(ent) {
    if (ent.remote) this.sendNet('host', '__i', { id: ent.id });
    else if (ent.net) { ent.emit('interact', this.handle(this.me)); this.events.emit('interact', this.handle(this.me), ent); }
    else { ent.emit('interact', this.handle(this.me)); this.events.emit('interact', this.handle(this.me), ent); }
  }

  hide(locker) {
    const p = this.player;
    p.hidden = locker;
    p.returnPos = p.pos.clone();
    const c = locker.obj.position;
    p.pos.set(c.x, c.y, c.z);
    p.yaw = locker.rotY + Math.PI;
    p.light = false;
    this.ui.setLocker(true);
    this.audio.play('door', { volume: 0.4, pitch: 1.6 });
  }

  unhide() {
    const p = this.player;
    if (!p.hidden) return;
    const l = p.hidden;
    p.hidden = null;
    const out = new THREE.Vector3(Math.sin(l.rotY), 0, Math.cos(l.rotY)).multiplyScalar(0.9).add(l.obj.position);
    p.pos.copy(out);
    this.ui.setLocker(false);
    this.audio.play('door', { volume: 0.4, pitch: 1.6 });
  }

  // ------------------------------------------------------------------ voice mixing
  // Decides how loud / muffled / radio-like each other player's voice should be for us.
  voiceMix() {
    const cam = this.renderer.camera;
    const meAlive = this.me.alive;
    const ears = this.player.pos.clone().add(new THREE.Vector3(0, this.player.eye, 0));
    const peers = {};
    const mode = this.config.voice;
    for (const p of this.players.values()) {
      if (p.isMe) continue;
      const mouth = p.pos.clone().add(new THREE.Vector3(0, p.crouch ? 0.95 : 1.6, 0));
      const d = mouth.distanceTo(ears);
      let gain = 1, lowpass = 20000, radio = false, spatial = true;
      if (mode === 'off') gain = 0;
      else if (mode === 'global') spatial = false;
      else {
        const range = this.config.voiceRange;
        gain = Math.pow(Math.max(0, 1 - d / range), 1.6);
        const walls = gain > 0 ? this.world.countBetween(mouth, ears, 3) : 0;
        if (walls) { gain *= Math.pow(0.55, walls); lowpass = 1600 / walls; }
        if (p.hidden) lowpass = Math.min(lowpass, 2500);
      }
      // the dead whisper to the living; ghosts hear each other clearly
      if (!p.alive && meAlive) { gain = d < 7 ? 0.22 * (1 - d / 7) : 0; lowpass = 3500; }
      if (!p.alive && !meAlive) { gain = 1; spatial = false; lowpass = 20000; }
      if (p.alive && p.tx && this.hasRadio() && meAlive) { radio = true; gain = Math.max(gain, 0.9); spatial = false; }
      peers[p.id] = { pos: [mouth.x, mouth.y, mouth.z], gain, lowpass, radio, spatial };
    }
    for (const fn of this.voiceHooks || []) for (const [id, mix] of Object.entries(peers)) {
      const r = this.safe(fn, 'voice.mix', this.handle(this.players.get(id)), mix);
      if (r && typeof r === 'object') peers[id] = { ...mix, ...r };
    }
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    parentPost({ t: 'voiceMix', listener: { pos: [ears.x, ears.y, ears.z], fwd: [fwd.x, fwd.y, fwd.z] }, peers });
    const effect = !this.me.alive && this.config.ghosts ? 'ghost' : this.me.voice || 'none';
    if (effect !== this.myVoice) { this.myVoice = effect; parentPost({ t: 'myVoice', effect }); }
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (!document.hidden) this.step(now, true);
  }

  // Browsers stop requestAnimationFrame in hidden tabs. A worker timer keeps the game simulating
  // (and the host serving the room) while the tab is in the background; only drawing is skipped.
  keepAliveInBackground() {
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
      w.onmessage = () => { if (document.hidden) this.step(performance.now(), false); };
    } catch {}
  }

  step(now, draw) {
    // rAF and the background worker use slightly different clocks; never let time run backwards
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = Math.max(this.last, now);
    this.time += dt;
    const p = this.player;
    if (this.started) {
      if (p.wasPressed('KeyT') || p.wasPressed('Enter')) { if (document.pointerLockElement) document.exitPointerLock(); this.ui.openChat(); }
      if (p.wasPressed('KeyM')) parentPost({ t: 'mute' });
      this.ui.playerList(p.keys.has('Tab'), [...this.players.values()].map((r) => ({ name: r.name, isMe: r.isMe, isHost: r.id === this.hostId, alive: r.alive, role: r.role, speaking: r.isMe ? this.mic.level : r.speaking })));
    }
    this.updateInteraction(dt);
    p.update(dt);
    this.monsterFx(dt);
    if (this.isHost) this.checkZones();
    this.world.update(dt, this.time);
    this.events.emit('update', dt);
    this.cine.update(dt);
    this.avatars.update(dt, this.time);
    // networking
    if (this.time - this.lastState > 1 / STATE_HZ) {
      this.lastState = this.time;
      this.sendState();
      if (this.isHost) {
        const w = this.world.flushNet();
        if (w) this.sendNet('others', '__w', w);
      }
    }
    if (this.time - this.lastMix > 0.08) { this.lastMix = this.time; this.voiceMix(); }
    // HUD
    const cfg = this.config;
    this.ui.stam.wrap.style.display = cfg.stamina && cfg.sprint && this.me.alive ? '' : 'none';
    this.ui.stam.set(p.stamina);
    this.ui.batt.wrap.style.display = cfg.flashlight && cfg.battery && this.me.alive ? '' : 'none';
    this.ui.batt.set(p.battery);
    this.ui.micLevel(this.me.alive ? p.noise : 0, this.mic.muted, this.mic.enabled);
    this.ui.inventory(this.me.inv || []);
    this.ui.tickStamp(this.time);
    if (!draw) return;
    this.renderer.assignLights(this.world.lights(), this.renderer.camera.position);
    tickTextures();
    this.renderer.render(dt, this.time);
    this.cine.afterRender();
  }

  // Heartbeat, flickering flashlight and chase music when a monster is close (every client).
  monsterFx(dt) {
    if (this.config.monsterFx === false) { this.heart?.stop(); this.heart = null; return; }
    let nearest = Infinity, chasingMe = false;
    for (const e of this.world.entities.values()) {
      if (!e.tags.has('monster') || !e.obj.visible) continue;
      nearest = Math.min(nearest, e.obj.position.distanceTo(this.player.pos));
      if (e.props.chasing === this.myId) chasingMe = true;
    }
    const alive = this.me.alive;
    const rate = alive ? Math.max(0, 1 - nearest / 16) : 0;
    if (rate > 0.05 && !this.heart) this.heart = this.audio.loop('heartbeat', { volume: 0.9, rate });
    if (this.heart) { this.heart.rate = rate; if (rate <= 0.05) { this.heart.stop(); this.heart = null; } }
    this.player.flickerAmount = alive && nearest < 9 ? 1 - nearest / 9 : 0;
    if (chasingMe && alive) { this.chaseT = 4; if (this.audio.musicName !== 'chase') this.audio.music('chase', 0.45); }
    else if (this.chaseT > 0) { this.chaseT -= dt; if (this.chaseT <= 0 && this.audio.musicName === 'chase') this.audio.music(null); }
  }

  checkZones() {
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'zone' || e.remote) continue;
      const [sx, sy, sz] = e.props.size || [2, 2, 2];
      const c = e.obj.position;
      e.inside ||= new Set();
      const list = e.net ? [...this.players.values()] : [this.me];
      for (const p of list) {
        const pos = p.isMe ? this.player.pos : p.pos;
        const inZone = Math.abs(pos.x - c.x) < sx / 2 && Math.abs(pos.y + 0.9 - c.y) < sy / 2 + 0.9 && Math.abs(pos.z - c.z) < sz / 2;
        if (inZone && !e.inside.has(p.id)) { e.inside.add(p.id); e.emit('enter', this.handle(p)); }
        else if (!inZone && e.inside.has(p.id)) { e.inside.delete(p.id); e.emit('exit', this.handle(p)); }
      }
    }
  }
}

// What scripts see as a "player". Reads are always allowed; changes only work on the host
// (or on yourself for purely local things like camera).
function makePlayerHandle(engine, rec) {
  const hostOnly = (what) => {
    if (!engine.isHost) { console.warn(`player.${what}() only works in host scripts`); return false; }
    return true;
  };
  const cmd = (c, ...a) => engine.sendNet(rec.id, '__cmd', { c, a });
  return {
    get id() { return rec.id; },
    get name() { return rec.name; },
    get isMe() { return rec.isMe; },
    get isHost() { return rec.id === engine.hostId; },
    get pos() { const v = rec.isMe ? engine.player.pos : rec.pos; return { x: v.x, y: v.y, z: v.z }; },
    get yaw() { return rec.isMe ? engine.player.yaw : rec.yaw; },
    get alive() { return rec.alive; },
    get role() { return rec.role; },
    get team() { return rec.team; },
    get noise() { return rec.isMe ? engine.player.noise : rec.noise; },
    get crouching() { return rec.isMe ? engine.player.crouch : rec.crouch; },
    get flashlight() { return rec.isMe ? engine.player.light : rec.light; },
    get hidden() { return rec.isMe ? !!engine.player.hidden : rec.hidden; },
    get speaking() { return rec.isMe ? engine.mic.level : rec.speaking; },
    get inventory() { return [...(rec.inv || [])]; },
    get data() { return rec.data; },
    get score() { return rec.score; },
    get connected() { return engine.players.has(rec.id); },
    distanceTo(o) { const a = this.pos, b = o.pos || o; return Math.hypot(a.x - b.x, a.y - (b.y ?? a.y), a.z - b.z); },
    has(item) { return (rec.inv || []).includes(item); },
    count(item) { return (rec.inv || []).filter((i) => i === item).length; },
    give(item) { if (hostOnly('give')) { engine.setPState(rec, { inv: [...rec.inv, item] }); } return this; },
    take(item) { if (hostOnly('take')) { const inv = [...rec.inv]; const i = inv.indexOf(item); if (i >= 0) inv.splice(i, 1); engine.setPState(rec, { inv }); return i >= 0; } return false; },
    kill(reason) {
      if (!hostOnly('kill') || !rec.alive) return this;
      engine.setPState(rec, { alive: false });
      engine.events.emit('playerDeath', this, reason);
      return this;
    },
    revive() { if (hostOnly('revive')) engine.setPState(rec, { alive: true }); return this; },
    setRole(role, o = {}) {
      if (!hostOnly('setRole')) return this;
      engine.setPState(rec, { role, model: o.model ?? (role === 'survivor' ? 'humanoid' : rec.model), speed: o.speed ?? rec.speed, voice: o.voice ?? rec.voice, vision: o.vision ?? null, team: o.team ?? rec.team });
      return this;
    },
    set(patch) { if (hostOnly('set')) engine.setPState(rec, patch); return this; },
    setData(key, value) { if (hostOnly('setData')) engine.setPState(rec, { data: { ...rec.data, [key]: value } }); return this; },
    addScore(n = 1) { if (hostOnly('addScore')) engine.setPState(rec, { score: (rec.score || 0) + n }); return this; },
    setSpeed(m) { if (hostOnly('setSpeed')) engine.setPState(rec, { speed: m }); return this; },
    teleport(x, y, z, yaw) { if (typeof x === 'object') ({ x, y, z } = x); cmd('teleport', x, y ?? 0.1, z, yaw); return this; },
    toast(text, secs, color) { cmd('toast', text, secs, color); return this; },
    message(text, secs, color) { return this.toast(text, secs, color); },
    subtitle(text, secs, speaker) { cmd('subtitle', text, secs, speaker); return this; },
    objective(text) { cmd('objective', text); return this; },
    note(title, text) { cmd('note', title, text); return this; },
    jumpscare(model = 'stalker', o) { cmd('jumpscare', model, o); return this; },
    shake(amount = 1) { cmd('shake', amount); return this; },
    fade(to = 1, secs = 1) { cmd('fade', to, secs); return this; },
    flash(color = 0xffffff, amount = 0.8) { cmd('flash', color, amount); return this; },
    sound(name, o) { cmd('sound', name, o); return this; },
    freeze(on = true) { cmd('freeze', on); return this; },
    rechargeFlashlight(amount = 1) { cmd('battery', amount); return this; },
    send(name, data) { cmd('msg', name, data); return this; },
    hide(locker) { if (rec.isMe) engine.hide(locker); return this; },
    unhide() { if (rec.isMe) engine.unhide(); else cmd('unhide'); return this; },
  };
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function r2(v) { return Math.round(v * 100) / 100; }
function fmt(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

window.shiver = new Engine();
