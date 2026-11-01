// Entities, colliders, raycasts, trigger zones and the navigation grid monsters walk on.
import * as THREE from '/vendor/three/three.module.js';
import { material, boxGeometry } from './textures.js';
import { createModel } from './models.js';

const V = () => new THREE.Vector3();
const ALL = () => true;
const tmpBox = new THREE.Box3();
const toArr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x ?? 0, v.y ?? 0, v.z ?? 0] : [0, 0, 0]);

export class Entity {
  constructor(world, kind, id, props, flags) {
    this.world = world;
    this.kind = kind;
    this.id = id;
    this.shared = !!flags.shared; // built by shared scripts on every player, state synced from the host
    this.net = !!flags.net; // replicated from the host
    this.remote = !!flags.remote; // a copy of a host entity on a client
    this.props = { pos: [0, 0, 0], rot: [0, 0, 0], visible: true, ...props };
    this.props.pos = toArr(this.props.pos);
    this.props.rot = toArr(this.props.rot);
    this.tags = new Set(props.tags || []);
    this.handlers = new Map();
    this.behaviors = [];
    this.data = {};
    this.collider = null;
    this.alive = true;
    this.speed = 0;
    this._last = new THREE.Vector3();
    this.target = null; // interpolation target for remote entities
    this.obj = new THREE.Group();
    this.obj.userData.entity = this;
    world.scene.add(this.obj);
    this.build();
    this.applyTransform(true);
    this.obj.visible = this.props.visible !== false;
    this.updateCollider();
    this._last.copy(this.obj.position);
  }

  // ---- convenient accessors (all go through set() so changes replicate) ----
  get x() { return this.props.pos[0]; }
  set x(v) { this.set({ pos: [v, this.props.pos[1], this.props.pos[2]] }); }
  get y() { return this.props.pos[1]; }
  set y(v) { this.set({ pos: [this.props.pos[0], v, this.props.pos[2]] }); }
  get z() { return this.props.pos[2]; }
  set z(v) { this.set({ pos: [this.props.pos[0], this.props.pos[1], v] }); }
  get pos() { return { x: this.props.pos[0], y: this.props.pos[1], z: this.props.pos[2] }; }
  set pos(v) { this.set({ pos: toArr(v) }); }
  get rotY() { return this.props.rot[1]; }
  set rotY(v) { this.set({ rot: [this.props.rot[0], v, this.props.rot[2]] }); }
  get visible() { return this.props.visible; }
  set visible(v) { this.set({ visible: !!v }); }
  get position() { return this.obj.position; }

  moveTo(x, y, z) { this.set({ pos: [x, y, z] }); return this; }
  lookAt(x, z) {
    if (typeof x === 'object') ({ x, z } = x.pos || x);
    this.rotY = Math.atan2(x - this.x, z - this.z);
    return this;
  }
  distanceTo(o) {
    const p = o.pos || o;
    return Math.hypot(p.x - this.x, (p.y ?? this.y) - this.y, p.z - this.z);
  }
  tag(...t) { t.forEach((x) => this.tags.add(x)); this.set({ tags: [...this.tags] }); return this; }
  hasTag(t) { return this.tags.has(t); }
  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, []);
    this.handlers.get(evt).push(fn);
    return this;
  }
  emit(evt, ...args) {
    for (const fn of this.handlers.get(evt) || []) this.world.engine.safe(fn, `entity ${evt}`, ...args);
  }
  behave(fn) { this.behaviors.push(fn); return this; }
  remove() { this.world.remove(this); }

  set(patch) {
    if (!this.alive) return this;
    if (patch.pos) patch.pos = toArr(patch.pos);
    if (patch.rot) patch.rot = toArr(patch.rot);
    if (patch.rotY != null) { patch.rot = [this.props.rot[0], patch.rotY, this.props.rot[2]]; delete patch.rotY; }
    Object.assign(this.props, patch);
    this.apply(patch);
    if (this.net && !this.remote) this.world.markDirty(this, patch);
    return this;
  }

  // Applies a props patch to the visuals. Called locally and when replicated patches arrive.
  apply(patch, fromNet) {
    const rebuild = ['size', 'color', 'glowColor', 'ppm', 'animation', 'texture', 'texScale', 'emissive', 'opacity', 'model', 'text', 'radius', 'height', 'width', 'unlit', 'fixture', 'textColor', 'fontSize'];
    if (rebuild.some((k) => k in patch)) this.build();
    if ('tags' in patch) this.tags = new Set(patch.tags);
    if ('pos' in patch || 'rot' in patch || 'scale' in patch) {
      if (fromNet && this.remote) {
        this.target = { pos: new THREE.Vector3(...this.props.pos), rot: this.props.rot.slice() };
        if (this.obj.position.distanceTo(this.target.pos) > 6 || patch.snap) this.applyTransform(true);
      } else this.applyTransform(true);
    }
    if ('visible' in patch) this.obj.visible = !!this.props.visible;
    if ('prompt' in patch || 'hold' in patch) this.world.updateInteractable(this);
    if ('burst' in patch && fromNet !== 'snapshot') this.flickerUntil = this.world.time + (this.props.burstTime || 1.5);
    if (this.kind === 'sound' && ('sound' in patch || 'volume' in patch || 'playing' in patch)) this.syncSound();
    if (['solid', 'pos', 'rot', 'size', 'scale', 'model', 'open'].some((k) => k in patch)) this.updateCollider();
  }

  applyTransform() {
    const [x, y, z] = this.props.pos;
    this.obj.position.set(x, y, z);
    const [rx, ry, rz] = this.props.rot;
    this.obj.rotation.set(rx, ry, rz);
    const s = this.props.scale;
    if (s != null) Array.isArray(s) ? this.obj.scale.set(...s) : this.obj.scale.setScalar(s);
  }

  build() {
    for (const c of [...this.obj.children]) this.obj.remove(c);
    const p = this.props;
    const matOpts = { color: p.color, texture: p.texture, emissive: p.emissive, opacity: p.opacity, unlit: p.unlit, double: p.double };
    let mesh = null;
    switch (this.kind) {
      case 'box': {
        const [w, h, d] = p.size || [1, 1, 1];
        mesh = new THREE.Mesh(boxGeometry(w, h, d, p.texScale || 2), material(matOpts));
        break;
      }
      case 'plane': {
        const [w, d] = p.size || [1, 1];
        const geo = new THREE.PlaneGeometry(w, d);
        const uv = geo.attributes.uv;
        const ts = p.texScale || 2;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / ts, (uv.getY(i) * d) / ts);
        mesh = new THREE.Mesh(geo, material({ ...matOpts, double: true }));
        if (!p.vertical) mesh.rotation.x = -Math.PI / 2;
        break;
      }
      case 'cylinder':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.radius ?? 0.5, p.radius ?? 0.5, p.height ?? 1, 12), material(matOpts));
        break;
      case 'sphere':
        mesh = new THREE.Mesh(new THREE.SphereGeometry(p.radius ?? 0.5, 12, 8), material(matOpts));
        break;
      case 'model':
        mesh = createModel(p.model || 'crate', { color: p.color, ppm: p.ppm, anim: p.animation });
        if (p.glowColor) mesh.traverse((o) => o.material?.emissiveIntensity > 1 && (o.material = o.material.clone(), o.material.emissive.set(p.glowColor), o.material.color.set(p.glowColor)));
        break;
      case 'light': {
        if (p.fixture && p.fixture !== 'none') {
          mesh = createModel(p.fixture);
          const glow = mesh.userData.glow;
          if (glow) { glow.material = glow.material.clone(); this.glow = glow; this.glowBase = glow.material.emissiveIntensity ?? 1; }
        }
        this.vl = { pos: new THREE.Vector3(), color: new THREE.Color(p.color ?? 0xfff2d0), intensity: 0, range: p.range ?? 8, base: p.intensity ?? 1.5 };
        break;
      }
      case 'text': {
        const c = document.createElement('canvas');
        const fs = 64;
        const g = c.getContext('2d');
        g.font = `bold ${fs}px ${p.font || 'Georgia, serif'}`;
        const lines = String(p.text ?? '').split('\n');
        c.width = Math.max(8, ...lines.map((l) => Math.ceil(g.measureText(l).width) + 16));
        c.height = lines.length * fs * 1.2 + 8;
        g.font = `bold ${fs}px ${p.font || 'Georgia, serif'}`;
        g.fillStyle = p.textColor || '#b01010';
        g.textBaseline = 'top';
        lines.forEach((l, i) => g.fillText(l, 8, 4 + i * fs * 1.2));
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const h = p.fontSize ?? 0.5;
        const w = (h * c.width) / (c.height / lines.length);
        const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
        mesh = p.billboard ? new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: true })) : new THREE.Mesh(new THREE.PlaneGeometry(w, h * lines.length), m);
        if (p.billboard) mesh.scale.set(w, h * lines.length, 1);
        break;
      }
      case 'door': {
        const w = p.width ?? 1.2, h = p.height ?? 2.2, t = p.thickness ?? 0.08;
        mesh = new THREE.Group();
        const panel = new THREE.Mesh(boxGeometry(w, h, t, 1), material({ texture: p.texture ?? 'door', color: p.color }));
        panel.position.set(w / 2, h / 2, 0);
        const knob = new THREE.Mesh(boxGeometry(0.06, 0.06, 0.18, 1), material({ color: 0xb0a080, metal: 0.9, rough: 0.3 }));
        knob.position.set(w - 0.12, h * 0.45, 0);
        mesh.add(panel, knob);
        this.panel = panel;
        this.doorAngle ??= p.open ? (p.openAngle ?? Math.PI / 2) : 0;
        mesh.rotation.y = this.doorAngle;
        this.hinge = mesh;
        break;
      }
      default:
        break; // zone, sound, group: invisible
    }
    if (mesh) {
      if (mesh.isMesh) { mesh.castShadow = this.kind !== 'plane'; mesh.receiveShadow = true; }
      this.obj.add(mesh);
      this.mesh = mesh;
      if (p.offset) mesh.position.add(new THREE.Vector3(...p.offset));
    }
  }

  isSolid() {
    const p = this.props;
    if (p.solid != null) return !!p.solid && p.visible !== false;
    return ['box', 'cylinder', 'door'].includes(this.kind);
  }

  updateCollider() {
    const w = this.world;
    if (!this.isSolid() || !this.alive) {
      if (this.collider) { w.colliders.delete(this.collider); this.collider = null; w.navDirty = true; }
      return;
    }
    this.obj.updateMatrixWorld(true);
    if (this.kind === 'zone' || this.kind === 'group' || this.kind === 'sound') return;
    const target = this.kind === 'door' ? this.panel : this.obj;
    if (!target) return;
    tmpBox.setFromObject(target);
    if (tmpBox.isEmpty()) return;
    if (!this.collider) { this.collider = { min: V(), max: V(), ent: this }; w.colliders.add(this.collider); }
    this.collider.min.copy(tmpBox.min);
    this.collider.max.copy(tmpBox.max);
    if (this.kind !== 'door') w.navDirty = true;
  }

  center(out = V()) {
    if (this.props.center) return out.set(...this.props.center).add(this.obj.position);
    tmpBox.setFromObject(this.obj);
    return tmpBox.isEmpty() ? out.copy(this.obj.position) : tmpBox.getCenter(out);
  }

  syncSound() {
    const p = this.props;
    this.loop?.stop();
    this.loop = null;
    if (p.sound && p.playing !== false) this.loop = this.world.engine.audio.loop(p.sound, { pos: this.obj.position, volume: p.volume ?? 1, range: p.range ?? 12 });
  }

  update(dt, t) {
    if (this.remote && this.target) {
      const k = 1 - Math.exp(-dt * 12);
      this.obj.position.lerp(this.target.pos, k);
      const [rx, ry, rz] = this.target.rot;
      let d = ry - this.obj.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.obj.rotation.set(rx, this.obj.rotation.y + d * k, rz);
    }
    this.speed = this.speed * 0.8 + (this.obj.position.distanceTo(this._last) / Math.max(dt, 1e-4)) * 0.2;
    this._last.copy(this.obj.position);
    if (this.kind === 'door') {
      const goal = this.props.open ? (this.props.openAngle ?? Math.PI / 2) : 0;
      if (Math.abs(goal - this.doorAngle) > 0.001) {
        this.doorAngle += (goal - this.doorAngle) * Math.min(1, dt * (this.props.slam ? 14 : 5));
        this.hinge.rotation.y = this.doorAngle;
        this.updateCollider();
      }
    }
    if (this.props.steps && this.speed > 0.3) {
      this.stepAcc = (this.stepAcc || 0) + this.speed * dt;
      if (this.stepAcc > (this.props.stride ?? 1.7)) {
        this.stepAcc = 0;
        this.world.engine.audio.play(this.props.steps, { pos: this.obj.position.clone(), volume: this.props.stepVolume ?? 1, range: 25 });
      }
    }
    if (this.props.spin) this.mesh && (this.mesh.rotation.y += dt * this.props.spin);
    if (this.props.bob) this.mesh && (this.mesh.position.y = Math.sin(t * 2.5) * 0.06);
    const anim = this.mesh?.userData?.animate;
    if (anim) anim(t, { speed: this.speed, dt, state: this.props.anim });
    if (this.kind === 'light') this.updateLight(dt, t);
    if (this.loop && this.remote) this.loop.setPos?.(this.obj.position);
  }

  updateLight(dt, t) {
    const p = this.props, vl = this.vl;
    this.obj.getWorldPosition(vl.pos);
    if (p.fixture === 'lamp') vl.pos.y -= 0.15;
    vl.range = p.range ?? 8;
    vl.color.set(p.color ?? 0xfff2d0);
    let f = p.on === false ? 0 : 1;
    const flicker = this.flickerUntil > t ? 0.85 : p.flicker || 0;
    if (f && flicker > 0) {
      this.fT = (this.fT ?? 0) - dt;
      if (this.fT <= 0) {
        this.fOn = Math.random() > flicker * 0.6;
        this.fT = this.fOn ? 0.05 + Math.random() * (1.5 / (flicker + 0.2)) : 0.03 + Math.random() * 0.15;
      }
      f = this.fOn ? 1 : 0.04;
    }
    vl.intensity = (p.intensity ?? 1.5) * f;
    if (this.glow) this.glow.material.emissiveIntensity = (this.glowBase ?? 1) * Math.max(0.05, f);
  }

  dispose() {
    this.alive = false;
    this.loop?.stop();
    this.obj.removeFromParent();
    if (this.collider) { this.world.colliders.delete(this.collider); this.world.navDirty = true; }
  }
}

export class World {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.renderer.scene;
    this.entities = new Map();
    this.colliders = new Set();
    this.interactables = new Set();
    this.dirty = new Map(); // id -> merged patch (host only)
    this.spawned = []; // host: entities spawned since last net tick
    this.removed = [];
    this.counter = 0;
    this.sharedCounter = 0;
    this.sharedPatches = new Map(); // host: everything that changed on shared entities (for late joiners)
    this.sharedRemoved = new Set();
    this.pending = new Map(); // patches for shared entities a client hasn't built yet
    this.time = 0;
    this.navDirty = true;
    this.nav = null;
  }

  spawn(kind, props = {}, { net = false, id = null, remote = false, shared = false } = {}) {
    if (shared) {
      id = 's' + ++this.sharedCounter;
      net = true;
      remote = !this.engine.isHost;
    }
    id ||= (net ? 'n' : 'l') + ++this.counter;
    const e = new Entity(this, kind, id, props, { net, remote, shared });
    this.entities.set(id, e);
    this.updateInteractable(e);
    if (kind === 'sound') e.syncSound();
    if (net && !remote && !shared) this.spawned.push(e);
    if (this.pending.has(id)) {
      const patch = this.pending.get(id);
      this.pending.delete(id);
      if (patch === null) this.remove(e);
      else { Object.assign(e.props, patch); e.apply(patch, 'snapshot'); }
    }
    return e;
  }

  remove(e) {
    if (!e || !e.alive) return;
    e.dispose();
    this.entities.delete(e.id);
    this.interactables.delete(e);
    this.dirty.delete(e.id);
    if (e.shared && !e.remote) this.sharedRemoved.add(e.id);
    if (e.net && !e.remote) {
      const i = this.spawned.indexOf(e);
      if (i >= 0) this.spawned.splice(i, 1);
      else this.removed.push(e.id);
    }
    e.emit('removed');
  }

  markDirty(e, patch) {
    if (e.shared) this.sharedPatches.set(e.id, Object.assign(this.sharedPatches.get(e.id) || {}, patch));
    if (this.spawned.includes(e)) return; // spawn message will carry the full props
    const cur = this.dirty.get(e.id) || {};
    this.dirty.set(e.id, Object.assign(cur, patch));
  }

  spec(e) {
    return { id: e.id, kind: e.kind, props: e.props };
  }

  // Host -> clients replication payload since last call.
  flushNet() {
    if (!this.spawned.length && !this.dirty.size && !this.removed.length) return null;
    const out = { s: this.spawned.map((e) => this.spec(e)), u: Object.fromEntries(this.dirty), r: this.removed };
    this.spawned = [];
    this.dirty = new Map();
    this.removed = [];
    return out;
  }

  applyNet({ s = [], u = {}, r = [] }, mode) {
    for (const sp of s) {
      const old = this.entities.get(sp.id);
      if (old) this.remove(old);
      this.spawn(sp.kind, sp.props, { id: sp.id, net: true, remote: true });
    }
    for (const [id, patch] of Object.entries(u)) {
      const e = this.entities.get(id);
      if (!e) { if (id[0] === 's') this.pending.set(id, Object.assign(this.pending.get(id) || {}, patch)); continue; }
      Object.assign(e.props, patch);
      e.apply(patch, mode || true);
    }
    for (const id of r) {
      if (this.entities.has(id)) this.remove(this.entities.get(id));
      else if (id[0] === 's') this.pending.set(id, null);
    }
  }

  updateInteractable(e) {
    if (e.props.prompt) this.interactables.add(e);
    else this.interactables.delete(e);
  }

  clear(filter = ALL) {
    for (const e of [...this.entities.values()]) if (filter(e)) {
      e.dispose();
      this.entities.delete(e.id);
      this.interactables.delete(e);
    }
    this.spawned = [];
    this.dirty = new Map();
    this.removed = [];
    this.navDirty = true;
    if (filter === ALL) {
      this.sharedCounter = 0;
      this.sharedPatches = new Map();
      this.sharedRemoved = new Set();
      this.pending = new Map();
    }
  }

  update(dt, t) {
    this.time = t;
    for (const e of this.entities.values()) {
      if (e.behaviors.length && !e.remote) for (const b of e.behaviors) this.engine.safe(b, 'behavior', dt, e);
      e.update(dt, t);
    }
  }

  lights() {
    const out = [];
    for (const e of this.entities.values()) if (e.kind === 'light' && e.vl && e.obj.visible) out.push(e.vl);
    return out;
  }

  // ---------------------------------------------------------------- queries
  raycast(origin, dir, max = 100, ignore) {
    let best = max, hit = null;
    for (const c of this.colliders) {
      if (ignore && ignore(c.ent)) continue;
      const t = rayAABB(origin, dir, c.min, c.max);
      if (t !== null && t < best) { best = t; hit = c; }
    }
    return hit ? { distance: best, point: origin.clone().addScaledVector(dir, best), entity: hit.ent } : null;
  }

  // Number of solid things between two points (used for muffling voices through walls).
  countBetween(a, b, cap = 3) {
    const dir = V().subVectors(b, a);
    const len = dir.length();
    if (len < 0.01) return 0;
    dir.divideScalar(len);
    let n = 0;
    for (const c of this.colliders) {
      if (c.ent.props.thin) continue;
      const t = rayAABB(a, dir, c.min, c.max);
      if (t !== null && t > 0.05 && t < len - 0.05 && ++n >= cap) break;
    }
    return n;
  }

  lineOfSight(a, b) {
    return this.countBetween(a, b, 1) === 0;
  }

  boxOverlaps(min, max, ignore) {
    const out = [];
    for (const c of this.colliders) {
      if (ignore && ignore(c.ent)) continue;
      if (min.x < c.max.x && max.x > c.min.x && min.y < c.max.y && max.y > c.min.y && min.z < c.max.z && max.z > c.min.z) out.push(c);
    }
    return out;
  }

  getNav() {
    if (!this.nav || this.navDirty) {
      this.nav = new NavGrid(this);
      this.navDirty = false;
    }
    return this.nav;
  }
}

function rayAABB(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
    } else {
      let t1 = (min[a] - o[a]) / d[a], t2 = (max[a] - o[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}

// ------------------------------------------------------------------ navigation
export class NavGrid {
  constructor(world, { y = 0, cell = 0.5, radius = 0.3 } = {}) {
    this.cell = cell;
    this.y = y;
    const cols = [...world.colliders];
    const xs = [], zs = [];
    for (const c of cols) { xs.push(c.min.x, c.max.x); zs.push(c.min.z, c.max.z); }
    if (!xs.length) xs.push(-20, 20), zs.push(-20, 20);
    this.x0 = Math.max(-200, Math.min(...xs)) - 1;
    this.z0 = Math.max(-200, Math.min(...zs)) - 1;
    this.w = Math.min(800, Math.ceil((Math.min(200, Math.max(...xs)) + 1 - this.x0) / cell));
    this.h = Math.min(800, Math.ceil((Math.min(200, Math.max(...zs)) + 1 - this.z0) / cell));
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    const floor = new Uint8Array(n);
    let hasFloor = false;
    const mark = (arr, minx, maxx, minz, maxz) => {
      const i0 = Math.max(0, Math.floor((minx - this.x0) / cell)), i1 = Math.min(this.w - 1, Math.floor((maxx - this.x0) / cell));
      const j0 = Math.max(0, Math.floor((minz - this.z0) / cell)), j1 = Math.min(this.h - 1, Math.floor((maxz - this.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) arr[j * this.w + i] = 1;
    };
    for (const c of cols) {
      const e = c.ent;
      if (e.kind === 'door' || e.props.navIgnore) continue;
      if (c.max.y > y + 0.35 && c.min.y < y + 1.8) mark(this.blocked, c.min.x - radius, c.max.x + radius, c.min.z - radius, c.max.z + radius);
      else if (c.max.y <= y + 0.35 && c.max.y > y - 0.6) { mark(floor, c.min.x + 0.1, c.max.x - 0.1, c.min.z + 0.1, c.max.z - 0.1); hasFloor = true; }
    }
    if (hasFloor) for (let i = 0; i < n; i++) if (!floor[i]) this.blocked[i] = 1;
    // connected regions so monsters only pick reachable wander points
    this.region = new Int32Array(n).fill(-1);
    let r = 0;
    const q = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (this.blocked[s] || this.region[s] >= 0) continue;
      let qh = 0, qt = 0;
      q[qt++] = s;
      this.region[s] = r;
      while (qh < qt) {
        const c = q[qh++], ci = c % this.w, cj = (c / this.w) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
          const k = nj * this.w + ni;
          if (!this.blocked[k] && this.region[k] < 0) { this.region[k] = r; q[qt++] = k; }
        }
      }
      r++;
    }
  }

  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  pos(k) {
    return new THREE.Vector3(this.x0 + ((k % this.w) + 0.5) * this.cell, this.y, this.z0 + (((k / this.w) | 0) + 0.5) * this.cell);
  }
  walkable(x, z) {
    const k = this.idx(x, z);
    return k >= 0 && !this.blocked[k];
  }
  nearestFree(k) {
    if (k < 0) return -1;
    if (!this.blocked[k]) return k;
    const ci = k % this.w, cj = (k / this.w) | 0;
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const n = j * this.w + i;
      if (!this.blocked[n]) return n;
    }
    return -1;
  }

  randomPoint(from, rand = Math.random) {
    const fk = from ? this.nearestFree(this.idx(from.x, from.z)) : -1;
    const region = fk >= 0 ? this.region[fk] : -1;
    for (let tries = 0; tries < 400; tries++) {
      const k = Math.floor(rand() * this.blocked.length);
      if (!this.blocked[k] && (region < 0 || this.region[k] === region)) return this.pos(k);
    }
    return from ? new THREE.Vector3(from.x, this.y, from.z) : this.pos(0);
  }

  lineFree(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const k = this.idx(a.x + (dx * s) / steps, a.z + (dz * s) / steps);
      if (k < 0 || this.blocked[k]) return false;
    }
    return true;
  }

  // A* over the grid, then string-pulled into a short list of waypoints.
  path(from, to, maxNodes = 20000) {
    const s = this.nearestFree(this.idx(from.x, from.z));
    const g = this.nearestFree(this.idx(to.x, to.z));
    if (s < 0 || g < 0 || this.region[s] !== this.region[g]) return null;
    if (s === g) return [this.pos(g)];
    const W = this.w, n = this.blocked.length;
    const cost = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const gi = g % W, gj = (g / W) | 0;
    const hfn = (k) => { const dx = Math.abs((k % W) - gi), dz = Math.abs(((k / W) | 0) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const heap = new Heap();
    cost[s] = 0;
    heap.push(s, hfn(s));
    let found = false, visited = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c === g) { found = true; break; }
      if (closed[c]) continue;
      closed[c] = 1;
      if (++visited > maxNodes) break;
      const ci = c % W, cj = (c / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const k = nj * W + ni;
        if (this.blocked[k] || closed[k]) continue;
        if (di && dj && (this.blocked[cj * W + ni] || this.blocked[nj * W + ci])) continue; // no corner cutting
        const nc = cost[c] + (di && dj ? 1.414 : 1);
        if (nc < cost[k]) { cost[k] = nc; came[k] = c; heap.push(k, nc + hfn(k)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = g; k >= 0; k = came[k]) cells.push(this.pos(k));
    cells.reverse();
    const out = [cells[0]];
    let anchor = cells[0];
    for (let i = 1; i < cells.length - 1; i++) {
      if (!this.lineFree(anchor, cells[i + 1])) { out.push(cells[i]); anchor = cells[i]; }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const { k, p } = this;
    let i = k.length;
    k.push(key); p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [k[i], k[par]] = [k[par], k[i]]; [p[i], p[par]] = [p[par], p[i]];
      i = par;
    }
  }
  pop() {
    const { k, p } = this;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[i], k[m]] = [k[m], k[i]]; [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}
