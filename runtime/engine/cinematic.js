// Cutscenes and movies. Scripts direct a camera, spawn actors, run dialogue and title cards;
// the overlay (letterbox, subtitles, titles) is drawn on a canvas so recordings include it.
import * as THREE from '/vendor/three/three.module.js';

const EASE = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
const V3 = (p) => (p?.isVector3 ? p.clone() : Array.isArray(p) ? new THREE.Vector3(...p) : new THREE.Vector3(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0));

export class Cinematic {
  constructor(engine) {
    this.engine = engine;
    this.defs = new Map();
    this.active = null; // running cutscene
    this.cam = { on: false, pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -1), fov: 60, roll: 0, follow: null };
    this.tweens = new Set();
    this.bars = 0;
    this.barsTarget = 0;
    this.sub = null; // { who, text, shown, start }
    this.titleCard = null; // { text, sub, until, start }
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'cine';
    document.getElementById('root').appendChild(this.overlay);
    this.g = this.overlay.getContext('2d');
    this.recorder = null;
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') this.advance = true;
      if (e.code === 'Escape' && this.active.skippable && this.engine.time - this.active.start > 0.6) this.skip();
    });
    addEventListener('mousedown', () => { if (this.active) this.advance = true; });
  }

  define(name, fn, opts = {}) { this.defs.set(name, { fn, opts }); }

  // Plays a cutscene for this player. Resolves when it ends (or is skipped).
  async play(nameOrFn, opts = {}) {
    const def = typeof nameOrFn === 'function' ? { fn: nameOrFn, opts: {} } : this.defs.get(nameOrFn);
    if (!def) { console.warn(`No cutscene called "${nameOrFn}"`); return; }
    if (this.active) this.finish(true);
    const o = { skippable: true, bars: true, hideHud: true, freeze: true, ...def.opts, ...opts };
    const run = { name: typeof nameOrFn === 'string' ? nameOrFn : 'cutscene', start: this.engine.time, skippable: o.skippable, actors: [], cancelled: false, o };
    run.done = new Promise((res) => (run.resolve = res));
    this.active = run;
    const e = this.engine;
    run.prevFrozen = e.player.frozen;
    if (o.freeze) e.player.frozen = true;
    if (o.hideHud) e.ui.hideHud(true);
    if (o.bars) this.barsTarget = 1;
    // start the camera where the player is looking, so the first move is smooth
    const cam = e.renderer.camera;
    this.cam.pos.copy(cam.position);
    this.cam.look.copy(cam.position).add(cam.getWorldDirection(new THREE.Vector3()));
    this.cam.fov = cam.fov;
    this.cam.roll = 0;
    this.cam.follow = null;
    this.cam.on = !!o.camera || o.camera === undefined;
    e.events.emit('cutsceneStart', run.name);
    // resolves when the script finishes OR the player skips (a skipped script just stops mid-await)
    const script = Promise.resolve()
      .then(() => def.fn(this.director(run)))
      .catch((err) => { if (err?.name !== 'CutsceneSkipped') this.engine.reportError(err, 'cutscene'); })
      .finally(() => { if (this.active === run) this.finish(); });
    await Promise.race([script, run.done]);
  }

  finish(skipped) {
    const run = this.active;
    if (!run) return;
    run.cancelled = true;
    this.active = null;
    run.resolve();
    const e = this.engine;
    for (const a of run.actors) if (!a.keep) e.world.remove(a.entity);
    for (const t of this.tweens) t.done?.();
    this.tweens.clear();
    this.cam.on = false;
    this.cam.follow = null;
    this.barsTarget = 0;
    this.sub = null;
    this.titleCard = null;
    this.choiceEl?.remove();
    e.player.frozen = run.prevFrozen;
    if (run.o.hideHud) e.ui.hideHud(false);
    e.player.baseFov = e.player.baseFov || 75;
    if (e.renderer.effects.fadeTarget > 0 && run.o.unfade !== false) { e.renderer.effects.fadeTarget = 0; e.renderer.effects.fadeSpeed = 1.5; }
    e.events.emit('cutsceneEnd', run.name, !!skipped);
  }

  skip() { this.finish(true); }

  // ---------------------------------------------------------------- the "c" object scripts get
  director(run) {
    const self = this, e = this.engine;
    const check = () => { if (run.cancelled) { const x = new Error('skipped'); x.name = 'CutsceneSkipped'; throw x; } };
    const wait = (secs) => new Promise((res, rej) => {
      const t = { left: secs, step(dt) { this.left -= dt; if (run.cancelled) { self.tweens.delete(this); rej(Object.assign(new Error('skipped'), { name: 'CutsceneSkipped' })); } else if (this.left <= 0) { self.tweens.delete(this); res(); } } };
      self.tweens.add(t);
    });
    const tween = (secs, ease, fn) => new Promise((res, rej) => {
      const f = EASE[ease] || EASE.inOut;
      const t = {
        el: 0,
        step(dt) {
          if (run.cancelled) { self.tweens.delete(this); return rej(Object.assign(new Error('skipped'), { name: 'CutsceneSkipped' })); }
          this.el += dt;
          const k = Math.min(1, this.el / Math.max(0.001, secs));
          fn(f(k));
          if (k >= 1) { self.tweens.delete(this); res(); }
        },
        done() { fn(1); },
      };
      self.tweens.add(t);
    });
    const C = self.cam;

    const camera = {
      at(pos, look) { check(); C.on = true; C.follow = null; C.pos.copy(V3(pos)); if (look) C.look.copy(V3(look)); return camera; },
      lookAt(target, o = {}) {
        check();
        C.on = true;
        const to = V3(target), from = C.look.clone();
        if (!o.duration) { C.look.copy(to); return Promise.resolve(); }
        return tween(o.duration, o.ease, (k) => C.look.lerpVectors(from, to, k));
      },
      moveTo(pos, o = {}) {
        check();
        C.on = true;
        C.follow = null;
        const p0 = C.pos.clone(), p1 = V3(pos), l0 = C.look.clone(), l1 = o.lookAt ? V3(o.lookAt) : null;
        return tween(o.duration ?? 2, o.ease, (k) => { C.pos.lerpVectors(p0, p1, k); if (l1) C.look.lerpVectors(l0, l1, k); });
      },
      orbit(o = {}) {
        check();
        C.on = true;
        C.follow = null;
        const c = V3(o.around || [0, 1, 0]), r = o.radius ?? 4, h = o.height ?? 1.5, a0 = o.from ?? 0, a1 = o.to ?? Math.PI;
        return tween(o.duration ?? 4, o.ease ?? 'linear', (k) => {
          const a = a0 + (a1 - a0) * k;
          C.pos.set(c.x + Math.sin(a) * r, c.y + h, c.z + Math.cos(a) * r);
          C.look.copy(c);
        });
      },
      follow(target, o = {}) { check(); C.on = true; C.follow = { target, offset: V3(o.offset || [0, 2, 4]), look: V3(o.lookOffset || [0, 1.4, 0]) }; return camera; },
      fov(f, o = {}) { const f0 = C.fov; return o.duration ? tween(o.duration, o.ease, (k) => (C.fov = f0 + (f - f0) * k)) : Promise.resolve((C.fov = f)); },
      roll(r, o = {}) { const r0 = C.roll; return o.duration ? tween(o.duration, o.ease, (k) => (C.roll = r0 + (r - r0) * k)) : Promise.resolve((C.roll = r)); },
      shake(a = 0.6) { e.player.shake = Math.max(e.player.shake, a); },
      // hand the camera back to the player's eyes
      async player(o = {}) {
        const cam = e.renderer.camera;
        const eye = e.player.pos.clone().add(new THREE.Vector3(0, e.player.eye, 0));
        const look = eye.clone().add(e.player.forward());
        if (o.duration) await camera.moveTo(eye, { lookAt: look, duration: o.duration, ease: o.ease });
        C.on = false;
        cam.fov = e.player.baseFov;
      },
    };

    const actor = (model, o = {}) => {
      check();
      const entity = model?.obj ? model : e.world.spawn('model', { model, pos: o.pos || [0, 0, 0], rot: [0, o.rotY ?? 0, 0], scale: o.scale, color: o.color, animation: o.animation, ppm: o.ppm, solid: false });
      const a = {
        entity, keep: !!o.keep,
        get pos() { return entity.pos; },
        moveTo(p) { entity.pos = V3(p); return a; },
        face(p, secs = 0) {
          const t = V3(p.pos || p), r0 = entity.rotY, r1 = Math.atan2(t.x - entity.x, t.z - entity.z);
          let d = Math.atan2(Math.sin(r1 - r0), Math.cos(r1 - r0));
          if (!secs) { entity.rotY = r0 + d; return Promise.resolve(); }
          return tween(secs, 'inOut', (k) => (entity.rotY = r0 + d * k));
        },
        walkTo(p, o2 = {}) {
          const from = V3(entity.pos), to = V3(p);
          to.y = o2.keepY ? from.y : to.y;
          const dist = from.distanceTo(to), speed = o2.speed ?? 1.4;
          entity.rotY = Math.atan2(to.x - from.x, to.z - from.z);
          return tween(dist / speed, 'linear', (k) => (entity.pos = new THREE.Vector3().lerpVectors(from, to, k)));
        },
        animate(tag) { entity.set({ animation: tag }); return a; },
        say(text, secs) { return say(o.name || 'Someone', text, secs); },
        remove() { e.world.remove(entity); },
      };
      run.actors.push(a);
      return a;
    };

    const say = async (who, text, secs) => {
      check();
      if (text === undefined) { text = who; who = null; }
      self.sub = { who, text: String(text), start: e.time };
      self.advance = false;
      const typeTime = text.length / 45;
      const hold = secs ?? Math.max(1.6, 1.2 + text.length * 0.045);
      let t = 0;
      await new Promise((res, rej) => {
        const tk = { step(dt) {
          if (run.cancelled) { self.tweens.delete(tk); return rej(Object.assign(new Error('skipped'), { name: 'CutsceneSkipped' })); }
          t += dt;
          if (self.advance) { self.advance = false; if (t < typeTime) { t = typeTime; self.sub.start = e.time - typeTime; } else { self.tweens.delete(tk); return res(); } }
          if (t >= typeTime + hold) { self.tweens.delete(tk); res(); }
        } };
        self.tweens.add(tk);
      });
      self.sub = null;
    };

    return {
      camera,
      actor,
      say,
      wait,
      title(text, sub = '', secs = 3) { self.titleCard = { text, sub, start: e.time, until: e.time + secs }; return wait(secs); },
      bars(on = true) { self.barsTarget = on ? 1 : 0; },
      fade(to = 1, secs = 1) { e.renderer.effects.fadeTarget = to; e.renderer.effects.fadeSpeed = 1 / Math.max(0.05, secs); return wait(secs); },
      flash(color = 0xffffff, amount = 1) { e.renderer.flash(color, amount); },
      shake(a = 0.6) { e.player.shake = Math.max(e.player.shake, a); },
      glitch(a = 1) { e.renderer.effects.glitch = a; },
      sound(name, o = {}) { return e.audio.play(name, { ...o, pos: o.pos ? V3(o.pos) : undefined }); },
      music(name, volume) { e.audio.music(name, volume); },
      jumpscare(model, o) { e.jumpscare(model, o); return wait(o?.duration ?? 1.1); },
      choice(question, options) {
        check();
        if (document.pointerLockElement) document.exitPointerLock();
        return new Promise((res) => {
          const el = document.createElement('div');
          el.className = 'choice';
          el.innerHTML = `<p></p>${options.map((_, i) => `<button data-i="${i}"></button>`).join('')}`;
          el.querySelector('p').textContent = question;
          el.querySelectorAll('button').forEach((b, i) => { b.textContent = options[i]; b.onclick = (ev) => { ev.stopPropagation(); el.remove(); self.choiceEl = null; res(i); }; });
          document.getElementById('root').appendChild(el);
          self.choiceEl = el;
        });
      },
      get time() { return e.time - run.start; },
      get skipped() { return run.cancelled; },
    };
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    for (const t of [...this.tweens]) t.step(dt);
    this.bars += (this.barsTarget - this.bars) * Math.min(1, dt * 4);
    if (this.cam.follow) {
      const tg = this.cam.follow.target;
      const p = tg.obj ? tg.obj.position : tg.pos;
      const pv = new THREE.Vector3(p.x, p.y, p.z);
      this.cam.pos.lerp(pv.clone().add(this.cam.follow.offset), Math.min(1, dt * 4));
      this.cam.look.copy(pv.add(this.cam.follow.look));
    }
    this.draw();
  }

  // Called by the player controller instead of its own camera logic while a cutscene owns the camera.
  applyCamera(cam) {
    cam.position.copy(this.cam.pos);
    cam.up.set(Math.sin(this.cam.roll), Math.cos(this.cam.roll), 0);
    cam.lookAt(this.cam.look);
    cam.fov = this.cam.fov;
    cam.updateProjectionMatrix();
  }

  draw() {
    const c = this.overlay, g = this.g, W = innerWidth, H = innerHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    g.clearRect(0, 0, W, H);
    const t = this.engine.time;
    if (this.bars > 0.01) {
      const bh = H * 0.11 * this.bars;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, bh);
      g.fillRect(0, H - bh, W, bh);
    }
    if (this.sub) {
      const shown = this.sub.text.slice(0, Math.floor((t - this.sub.start) * 45));
      const size = Math.max(16, Math.round(H * 0.032));
      g.font = `${size}px ui-monospace, Menlo, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const lines = wrap(g, (this.sub.who ? this.sub.who.toUpperCase() + ':  ' : '') + shown, W * 0.7);
      const y0 = H - H * 0.11 * Math.max(this.bars, 0.6) - lines.length * size * 1.35 + size * 0.2;
      lines.forEach((l, i) => {
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillText(l, W / 2 + 2, y0 + i * size * 1.35 + 2);
        g.fillStyle = '#eee4cc';
        g.fillText(l, W / 2, y0 + i * size * 1.35);
      });
    }
    if (this.titleCard) {
      const tc = this.titleCard;
      const life = tc.until - tc.start, k = (t - tc.start) / life;
      if (k >= 1) this.titleCard = null;
      else {
        const alpha = Math.min(1, k * 5, (1 - k) * 4);
        g.globalAlpha = Math.max(0, alpha);
        g.textAlign = 'center';
        g.fillStyle = '#e8dcc0';
        g.font = `${Math.round(H * 0.09)}px Georgia, serif`;
        g.fillText(tc.text, W / 2, H * 0.5);
        if (tc.sub) { g.font = `${Math.round(H * 0.03)}px ui-monospace, Menlo, monospace`; g.fillStyle = '#b02020'; g.fillText(tc.sub.toUpperCase(), W / 2, H * 0.5 + H * 0.06); }
        g.globalAlpha = 1;
      }
    }
    if (this.active?.skippable && this.engine.time - this.active.start > 0.6 && !this.recorder) {
      g.font = '11px ui-monospace, Menlo, monospace';
      g.textAlign = 'right';
      g.fillStyle = 'rgba(232,226,208,0.45)';
      g.fillText('ESC to skip · SPACE to continue', W - 16, H - 12);
    }
  }

  // Must run right after the WebGL frame is drawn (the canvas is cleared once it's on screen).
  afterRender() {
    this.recorder?.frame();
  }

  // ---------------------------------------------------------------- recording movies
  // Records the game view + overlay + game audio to a WebM video, handed to the platform to download.
  record(o = {}) {
    if (this.recorder) return;
    const e = this.engine;
    const src = e.renderer.canvas;
    const out = document.createElement('canvas');
    const scale = Math.min(1, (o.height ?? 720) / src.height);
    out.width = Math.round(src.width * scale) & ~1;
    out.height = Math.round(src.height * scale) & ~1;
    const g = out.getContext('2d');
    const stream = out.captureStream(o.fps ?? 30);
    const dest = e.audio.ctx.createMediaStreamDestination();
    e.audio.comp.connect(dest);
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: o.bitrate ?? 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      try { e.audio.comp.disconnect(dest); } catch {}
      const blob = new Blob(chunks, { type: 'video/webm' });
      e.post({ t: 'movie', blob, name: o.name || e.game.title });
      e.events.emit('recorded', blob);
    };
    rec.start(250);
    this.recorder = {
      rec, started: e.time, canvas: out,
      frame: () => { g.drawImage(src, 0, 0, out.width, out.height); g.drawImage(this.overlay, 0, 0, out.width, out.height); },
    };
    e.post({ t: 'recording', on: true });
  }

  stopRecording() {
    if (!this.recorder) return;
    this.recorder.rec.stop();
    this.recorder = null;
    this.engine.post({ t: 'recording', on: false });
  }

  reset() {
    this.finish();
    this.defs.clear();
  }
}

function wrap(g, text, max) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > max && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
