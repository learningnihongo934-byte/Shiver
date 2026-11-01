// The scripting API. Every name returned here is a global inside creator scripts.
// kind: 'shared' (every player), 'host' (only the room host — the "server"), 'client' (every player).
import * as THREE from '/vendor/three/three.module.js';
import { prefabs } from './prefabs.js';
import { builders } from './build.js';
import { MODEL_NAMES } from './models.js';
import { TEXTURE_NAMES, assetNames, getAsset } from './textures.js';
import { STYLES } from './render.js';

export function makeRand(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const r = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + r() * (b - a);
  r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  r.seed = (n) => { s = n >>> 0; };
  return r;
}

export function buildApi(engine, kind, scriptName) {
  const isHostScript = kind === 'host';
  const net = isHostScript; // entities made by host scripts replicate to everyone
  const round = engine.roundId;
  const live = () => engine.roundId === round; // stale timers from old rounds stop by themselves
  const W = engine.world;
  const toV = (p) => (Array.isArray(p) ? new THREE.Vector3(...p) : new THREE.Vector3(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0));
  // host scripts -> replicated; shared scripts -> built on every player, synced by id; client -> local only
  const spawn = (k, props, o = {}) => {
    if (o.local) return W.spawn(k, props, {});
    if (kind === 'shared') return W.spawn(k, props, { shared: true });
    return W.spawn(k, props, { net });
  };
  const handles = () => [...engine.players.values()].map((p) => engine.handle(p));
  const rand = makeRand(engine.seed + [...scriptName].reduce((a, c) => a + c.charCodeAt(0), 0) * 7919 + round * 104729);
  const sharedRand = makeRand(engine.seed + round * 104729); // same sequence on every player

  const on = (name, fn) => engine.events.on(name, fn);

  const game = {
    get id() { return engine.game.id; },
    get title() { return engine.game.title; },
    get seed() { return engine.seed; },
    get isHost() { return engine.isHost; },
    get time() { return engine.time; },
    get code() { return engine.code; },
    get mode() { return engine.mode; },
    get round() { return engine.roundId; },
    get draft() { return !!engine.game.draft; },
    get ended() { return !!engine.ended; },
    script: scriptName,
    kind,
    config(o = {}) {
      Object.assign(engine.config, o);
      if (o.camera) engine.player.setMode(o.camera);
      if (o.fov) engine.player.baseFov = o.fov;
      return engine.config;
    },
    end(o = {}) {
      if (!engine.isHost) return console.warn('game.end() only works in host scripts');
      engine.sendNet('all', '__end', o);
    },
    endFor(player, o = {}) { if (engine.isHost) engine.sendNet(player.id, '__end', o); },
    restart() {
      if (!engine.isHost) return console.warn('game.restart() only works in host scripts');
      engine.sendNet('others', '__restart', {});
      setTimeout(() => engine.startRound(), 0);
    },
    lock(locked = true) { if (engine.isHost) engine.post({ t: 'net-lock', locked }); },
    on,
    // Replicated key/value state: host sets, everyone can read and watch.
    state: {
      get(k) { return engine.gameState[k]; },
      set(k, v) {
        if (!engine.isHost) return console.warn('game.state.set() only works in host scripts');
        engine.setLocalState(k, v);
        engine.sendNet('others', '__gs', { k, v });
      },
      watch(k, fn) {
        if (!engine.stateWatchers.has(k)) engine.stateWatchers.set(k, new Set());
        engine.stateWatchers.get(k).add(fn);
        if (k in engine.gameState) engine.safe(fn, 'state.watch', engine.gameState[k]);
      },
      all() { return { ...engine.gameState }; },
    },
  };

  const world = {
    box: (o) => spawn('box', o, o),
    plane: (o) => spawn('plane', o, o),
    cylinder: (o) => spawn('cylinder', o, o),
    sphere: (o) => spawn('sphere', o, o),
    model: (name, o = {}) => spawn('model', { ...o, model: name }, o),
    // Pixeter art / images from the Studio's Assets panel, as a camera-facing sprite.
    sprite: (name, o = {}) => spawn('model', { solid: false, ...o, model: 'asset:' + name }, o),
    get assets() { return assetNames(); },
    asset: (name) => { const a = getAsset(name); return a && { name: a.name, w: a.w, h: a.h, frames: a.frames.length, tags: a.tags.map((t) => t.name) }; },
    light: (o = {}) => spawn('light', o, o),
    text: (text, o = {}) => spawn('text', { ...o, text }, o),
    zone: (o = {}) => spawn('zone', { solid: false, ...o }, o),
    sound: (name, o = {}) => spawn('sound', { ...o, sound: name }, o),
    door: (o = {}) => spawn('door', o, o),
    spawn: (k, o = {}) => spawn(k, o, o),
    get(id) { return W.entities.get(id) || null; },
    find(tag) { return [...W.entities.values()].filter((e) => e.tags.has(tag)); },
    findOne(tag) { for (const e of W.entities.values()) if (e.tags.has(tag)) return e; return null; },
    all() { return [...W.entities.values()]; },
    remove(e) { W.remove(e); },
    spawnPoint(x, y = 0.1, z, yaw = 0) {
      if (typeof x === 'object') ({ x, y = 0.1, z, yaw = 0 } = x);
      engine.spawnPoints.push({ x, y, z, yaw });
    },
    clearSpawnPoints() { engine.spawnPoints = []; },
    raycast(from, dir, max = 50) {
      const h = W.raycast(toV(from), toV(dir).normalize(), max);
      return h && { distance: h.distance, point: { x: h.point.x, y: h.point.y, z: h.point.z }, entity: h.entity };
    },
    lineOfSight(a, b) { return W.lineOfSight(toV(a), toV(b)); },
    fog(color = 0x020203, density) {
      engine.renderer.scene.fog.color.set(color);
      engine.renderer.scene.background.set(color);
      if (density != null) { engine.renderer.scene.fog.density = density; engine.renderer.fogLocked = true; }
    },
    ambient(intensity = 0.1, sky = 0x8890a0, ground = 0x201810) {
      const hl = engine.renderer.hemi;
      hl.intensity = intensity;
      hl.color.set(sky);
      hl.groundColor.set(ground);
    },
    sky(color) { engine.renderer.scene.background.set(color); },
    // Directional light for outdoor levels.
    moon(intensity = 0.6, color = 0x8090c0) { engine.renderer.moon.intensity = intensity; engine.renderer.moon.color.set(color); },
    add(object3d) { engine.renderer.scene.add(object3d); return object3d; },
    get scene() { return engine.renderer.scene; },
    models: MODEL_NAMES,
    textures: TEXTURE_NAMES,
  };

  const players = {
    all: handles,
    list: handles,
    alive: () => handles().filter((p) => p.alive),
    dead: () => handles().filter((p) => !p.alive),
    get: (id) => engine.handle(engine.players.get(id)),
    get me() { return engine.handle(engine.me); },
    get host() { return engine.handle(engine.players.get(engine.hostId)); },
    get count() { return engine.players.size; },
    nearest(pos, filter = (p) => p.alive) {
      let best = null, bd = Infinity;
      for (const p of handles()) { if (!filter(p)) continue; const d = p.distanceTo(pos); if (d < bd) { bd = d; best = p; } }
      return best;
    },
    random(filter = () => true) { const l = handles().filter(filter); return l.length ? l[Math.floor(rand() * l.length)] : null; },
    on,
  };

  const me = {
    get player() { return engine.handle(engine.me); },
    get pos() { const p = engine.player.pos; return { x: p.x, y: p.y, z: p.z }; },
    get yaw() { return engine.player.yaw; },
    get pitch() { return engine.player.pitch; },
    get forward() { const f = engine.player.forward(); return { x: f.x, y: f.y, z: f.z }; },
    get noise() { return engine.player.noise; },
    get flashlight() { return engine.player.light; },
    set flashlight(v) { engine.player.light = !!v; },
    get battery() { return engine.player.battery; },
    set battery(v) { engine.player.battery = Math.max(0, Math.min(1, v)); },
    get stamina() { return engine.player.stamina; },
    set stamina(v) { engine.player.stamina = Math.max(0, Math.min(1, v)); },
    get alive() { return engine.me.alive; },
    get hidden() { return !!engine.player.hidden; },
    makeNoise(v) { engine.player.addNoise(v); },
    teleport(x, y, z, yaw) { if (typeof x === 'object') ({ x, y, z } = x); engine.player.pos.set(x, y ?? 0.1, z); engine.player.vel.set(0, 0, 0); if (yaw != null) engine.player.yaw = yaw; },
    lookAt(x, y, z) { if (x == null) { engine.player.lookTarget = null; return; } if (typeof x === 'object') ({ x, y, z } = x); engine.player.lookTarget = new THREE.Vector3(x, y, z); },
    freeze(on = true) { engine.player.frozen = on; },
    hide(locker) { engine.hide(locker); },
    unhide() { engine.unhide(); },
  };

  const input = {
    key: (code) => engine.player.keys.has(code),
    pressed: (code) => engine.player.wasPressed(code),
    get mouse() { const m = engine.player.mouse; return { x: m.x, y: m.y, down: m.down }; },
    mouseButton: (b = 0) => engine.player.mouse.buttons.has(b),
    on,
  };

  const ui = {
    objective: (t) => engine.ui.objective(t),
    toast: (t, s, c) => engine.ui.toast(t, s, c),
    subtitle: (t, s, who) => engine.ui.subtitle(t, s, who),
    note: (title, text) => { if (document.pointerLockElement) document.exitPointerLock(); engine.ui.note(title, text); },
    text: (id, t, o) => engine.ui.text(id, t, o),
    progress: (id, v, o) => engine.ui.progress(id, v, o),
    remove: (id) => engine.ui.remove(id),
    element: (tag) => engine.ui.element(tag),
    image: (id, name, o) => engine.ui.image(id, getAsset(name), o),
    hideHud: (v = true) => engine.ui.hideHud(v),
    chat: (name, text, color) => engine.ui.chat(name, text, color),
  };

  const audio = {
    play(name, o = {}) {
      const pos = o.pos ? toV(o.pos) : undefined;
      if (o.everyone && engine.isHost) return engine.fxAll({ sound: name, pos: pos && [pos.x, pos.y, pos.z], volume: o.volume, pitch: o.pitch, range: o.range });
      return engine.audio.play(name, { ...o, pos });
    },
    loop(name, o = {}) { return engine.audio.loop(name, { ...o, pos: o.pos ? toV(o.pos) : undefined }); },
    music(name, volume, o = {}) {
      if (o.everyone && engine.isHost) return engine.fxAll({ music: name, volume });
      engine.audio.music(name, volume);
    },
    volume: (v) => engine.audio.setVolume(v),
    get context() { return engine.audio.ctx; },
    get output() { return engine.audio.master; },
    names: engine.audio.names,
  };

  const fx = {
    shake: (a = 1) => (engine.player.shake = Math.max(engine.player.shake, a)),
    flash: (c = 0xffffff, a = 0.8) => engine.renderer.flash(c, a),
    fade: (to = 1, secs = 1) => { engine.renderer.effects.fadeTarget = to; engine.renderer.effects.fadeSpeed = 1 / Math.max(0.05, secs); },
    glitch: (a = 1) => (engine.renderer.effects.glitch = a),
    damage: (a = 0.6) => (engine.renderer.effects.damage = a),
    thermal: (a = 0.85) => (engine.renderer.effects.thermal = a),
    jumpscare: (model = 'stalker', o) => engine.jumpscare(model, o),
    everyone(o) { if (engine.isHost) engine.fxAll(o); },
  };

  const camera = {
    mode: (m) => engine.player.setMode(m),
    get current() { return engine.player.cameraMode; },
    fov: (f) => (engine.player.baseFov = f),
    get object() { return engine.renderer.camera; },
  };

  const render = {
    style: (name, overrides) => engine.renderer.setStyle(name, overrides),
    get current() { return engine.renderer.styleName; },
    set: (o) => engine.renderer.setStyle(engine.renderer.styleName, { ...engine.renderer.style, ...o }),
    styles: Object.keys(STYLES),
    get renderer() { return engine.renderer.gl; },
  };

  const netApi = {
    // client -> host
    send(name, data) { engine.sendNet('host', name, data); },
    // host -> everyone (including the host's own client scripts)
    broadcast(name, data) {
      if (!engine.isHost) return console.warn('net.broadcast() only works in host scripts');
      engine.sendNet('all', name, data);
    },
    to(player, name, data) { engine.sendNet(player.id ?? player, name, data); },
    on(name, fn) {
      if (!engine.netHandlers.has(name)) engine.netHandlers.set(name, new Set());
      engine.netHandlers.get(name).add(fn);
      return () => engine.netHandlers.get(name)?.delete(fn);
    },
  };

  const voice = {
    mix(fn) { (engine.voiceHooks ||= []).push(fn); },
    setEffect(player, effect) { if (engine.isHost) engine.setPState(engine.players.get(player.id), { voice: effect }); },
    mode(m) { engine.config.voice = m; },
    get micLevel() { return engine.mic.level; },
    get muted() { return engine.mic.muted; },
  };

  const nav = {
    path(from, to) { const p = W.getNav().path(toV(from), toV(to)); return p && p.map((v) => ({ x: v.x, y: v.y, z: v.z })); },
    randomPoint(near) { const v = W.getNav().randomPoint(near && toV(near), rand); return { x: v.x, y: v.y, z: v.z }; },
    walkable(x, z) { return W.getNav().walkable(x, z); },
    rebuild() { W.navDirty = true; },
  };

  const timers = {
    wait: (secs) => new Promise((res, rej) => setTimeout(() => (live() ? res() : rej(new StaleRound())), secs * 1000)),
    after(secs, fn) { const id = setTimeout(() => live() && engine.safe(fn, 'after()'), secs * 1000); return () => clearTimeout(id); },
    every(secs, fn) { const id = setInterval(() => (live() ? engine.safe(fn, 'every()') : clearInterval(id)), secs * 1000); return () => clearInterval(id); },
  };

  const vec = {
    dist: (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z),
    dist2d: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    lerp: (a, b, t) => a + (b - a) * t,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    v3: (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z),
  };

  // Cutscenes & movies: cutscene.define('intro', async (c) => { ... }); cutscene.play('intro')
  const cutscene = {
    define: (name, fn, opts) => engine.cine.define(name, fn, opts),
    play(nameOrFn, opts = {}) {
      if (opts.everyone) {
        if (!engine.isHost || typeof nameOrFn !== 'string') return console.warn('cutscene.play(name, { everyone: true }) needs a defined name and a host script');
        for (const p of engine.players.values()) engine.sendNet(p.id, '__cmd', { c: 'cutscene', a: [nameOrFn, { ...opts, everyone: false }] });
        return Promise.resolve();
      }
      if (opts.player && !opts.player.isMe) { engine.sendNet(opts.player.id, '__cmd', { c: 'cutscene', a: [nameOrFn, { ...opts, player: null }] }); return Promise.resolve(); }
      return engine.cine.play(nameOrFn, opts);
    },
    skip: () => engine.cine.skip(),
    get playing() { return engine.cine.active?.name || null; },
    on,
  };
  const movie = {
    record: (o) => engine.cine.record(o),
    stop: () => engine.cine.stopRecording(),
    get recording() { return !!engine.cine.recorder; },
  };

  const ctx = { engine, kind, net, spawn, rand, sharedRand, world, players, ui, audio, fx, game, toV, live };
  const prefab = (ctx.prefab = prefabs(ctx));
  const build = builders(ctx);

  return {
    game, world, players, me, input, ui, audio, fx, camera, render, net: netApi, cutscene, movie, voice, nav, prefab, build, vec, THREE,
    on, wait: timers.wait, after: timers.after, every: timers.every,
    rand, sharedRand, isHost: engine.isHost, log: (...a) => console.log(...a),
  };
}

class StaleRound extends Error {
  constructor() { super('round ended'); this.name = 'StaleRound'; }
}
