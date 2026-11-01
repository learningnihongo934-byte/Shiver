// Ready-made horror building blocks. All of them are plain entities with behaviour attached,
// so creators can read this file to learn how to write their own.
import * as THREE from '/vendor/three/three.module.js';

export function prefabs(ctx) {
  const { engine, spawn, toV, rand } = ctx;
  const W = engine.world;

  // Play a sound for everyone (if this entity is synced) or just locally.
  const sfx = (ent, name, o = {}) => {
    const pos = o.pos || ent.props.pos;
    if (ent.net && engine.isHost) engine.fxAll({ sound: name, pos, volume: o.volume, pitch: o.pitch, range: o.range });
    else if (!ent.net) engine.audio.play(name, { pos: toV(pos), volume: o.volume, pitch: o.pitch, range: o.range });
  };
  const P = {};

  P.light = (o = {}) => {
    const l = spawn('light', { pos: o.pos, color: o.color ?? 0xfff2d0, intensity: o.intensity ?? 1.6, range: o.range ?? 9, flicker: o.flicker ?? 0, fixture: o.fixture ?? 'lamp', on: o.on ?? true, rot: o.rot, tags: ['light', ...(o.tags || [])] }, o);
    l.turnOn = () => l.set({ on: true });
    l.turnOff = () => l.set({ on: false });
    l.toggle = () => l.set({ on: l.props.on === false });
    l.flicker = (secs = 1.5) => l.set({ burst: (l.props.burst || 0) + 1, burstTime: secs });
    return l;
  };

  P.candle = (o = {}) => P.light({ fixture: 'candle', color: 0xff9a40, intensity: 1.1, range: 4.5, flicker: 0.05, ...o });
  P.bulb = (o = {}) => P.light({ fixture: 'bulb', color: 0xffc98a, intensity: 1.4, range: 7, ...o });

  P.door = (o = {}) => {
    const d = spawn('door', {
      pos: o.pos, rot: [0, o.rotY ?? 0, 0], width: o.width ?? 1.2, height: o.height ?? 2.2, texture: o.texture ?? 'door', color: o.color,
      open: !!o.open, locked: !!o.locked, key: o.key ?? null, prompt: o.locked ? 'Locked door' : o.open ? 'Close' : 'Open', tags: ['door', ...(o.tags || [])],
    }, o);
    d.toggle = (open = !d.props.open) => {
      d.set({ open, slam: false, prompt: d.props.locked ? 'Locked door' : open ? 'Close' : 'Open' });
      sfx(d, 'door', { volume: 0.7, pitch: 0.9 + Math.random() * 0.2 });
      d.emit(open ? 'opened' : 'closed');
    };
    d.slam = () => { d.set({ open: false, slam: true, prompt: d.props.locked ? 'Locked door' : 'Open' }); sfx(d, 'slam'); };
    d.burst = () => { d.set({ open: true, slam: true, prompt: 'Close' }); sfx(d, 'slam'); };
    d.lock = (key) => d.set({ locked: true, key: key ?? d.props.key, open: false, prompt: 'Locked door' });
    d.unlock = () => d.set({ locked: false, prompt: d.props.open ? 'Close' : 'Open' });
    d.on('interact', (p) => {
      if (d.props.locked) {
        if (d.props.key && p.has(d.props.key)) {
          if (o.consumeKey) p.take(d.props.key);
          d.unlock();
          p.toast(`Unlocked with ${d.props.key}`);
          sfx(d, 'click', { volume: 1 });
        } else {
          sfx(d, 'locked');
          p.toast(o.lockedText || (d.props.key ? `Locked. Needs ${d.props.key}.` : "It won't budge."));
          return;
        }
      }
      d.toggle();
    });
    return d;
  };

  // Something you can pick up. Goes into the player's inventory as `name`.
  P.item = (o = {}) => {
    const name = o.name ?? 'Item';
    const e = spawn('model', { model: o.model ?? 'key', pos: o.pos, color: o.color, prompt: o.prompt ?? `Take ${name}`, spin: o.spin ?? 1.2, bob: o.bob ?? true, solid: false, range: o.range ?? 2.2, tags: ['item', ...(o.tags || [])] }, o);
    e.itemName = name;
    let glow = null;
    if (o.glow !== false) {
      glow = spawn('light', { pos: toV(o.pos).add(new THREE.Vector3(0, 0.4, 0)).toArray(), color: o.glowColor ?? 0x8fb6ff, intensity: 0.5, range: 2.2, fixture: 'none' }, o);
      e.on('removed', () => glow.remove());
    }
    e.on('interact', (p) => {
      if (!e.alive) return;
      if (o.onPickup?.(p, e) === false) return;
      if (o.inventory !== false) p.give(name);
      p.sound('pickup');
      p.toast(o.pickupText ?? `Picked up ${name}`);
      engine.events.emit('pickup', p, name, e);
      e.remove();
    });
    return e;
  };
  P.key = (o = {}) => P.item({ model: 'key', name: 'Key', glowColor: 0xffd27a, ...o });
  P.fuse = (o = {}) => P.item({ model: 'fuse', name: 'Fuse', glowColor: 0x5ad0ff, ...o });
  P.radio = (o = {}) => P.item({ model: 'radio', name: 'Radio', pickupText: 'Picked up a Radio. Hold R to talk to anyone else with one.', glowColor: 0xff6050, ...o });
  P.battery = (o = {}) => P.item({ model: 'battery', name: 'Battery', glowColor: 0x6aff8a, inventory: false, pickupText: 'Flashlight recharged', onPickup: (p) => { p.rechargeFlashlight(o.amount ?? 0.5); }, ...o });

  P.note = (o = {}) => {
    const n = spawn('model', { model: 'note', pos: o.pos, rot: [0, o.rotY ?? rand() * 6, 0], prompt: o.prompt ?? 'Read note', solid: false, range: 2, tags: ['note'] }, o);
    n.on('interact', (p) => { p.note(o.title ?? '', o.text ?? ''); p.sound('swoosh'); engine.events.emit('read', p, n); });
    return n;
  };

  P.prop = (name, o = {}) => spawn('model', { model: name, pos: o.pos, rot: [0, o.rotY ?? 0, 0], color: o.color, scale: o.scale, solid: o.solid ?? true, tags: ['prop', ...(o.tags || [])] }, o);

  P.locker = (o = {}) => {
    const l = spawn('model', { model: 'locker', pos: o.pos, rot: [0, o.rotY ?? 0, 0], color: o.color, prompt: 'Hide', solid: true, range: 1.8, tags: ['locker'] }, o);
    l.on('interact', (p) => (p.isMe ? engine.hide(l) : engine.sendNet(p.id, '__cmd', { c: 'hideIn', a: [l.id] })));
    return l;
  };

  P.tv = (o = {}) => {
    const t = P.prop('tv', { solid: true, ...o });
    const l = P.light({ pos: toV(o.pos).add(new THREE.Vector3(Math.sin(o.rotY ?? 0) * 0.6, 0.4, Math.cos(o.rotY ?? 0) * 0.6)).toArray(), color: 0x9ab0ff, intensity: 1, range: 4, flicker: 0.6, fixture: 'none' });
    const s = spawn('sound', { sound: 'static', pos: o.pos, volume: 0.25, range: 6 }, o);
    t.on('removed', () => { l.remove(); s.remove(); });
    return t;
  };

  P.blood = (o = {}) => spawn('plane', { pos: toV(o.pos ?? [0, 0.02, 0]).toArray(), size: [o.size ?? 1.2, o.size ?? 1.2], texture: 'blood', texScale: o.size ?? 1.2, rot: [0, rand() * 6, 0], solid: false, tags: ['decal'] }, o);

  P.writing = (text, o = {}) => spawn('text', { text, pos: o.pos, rot: [0, o.rotY ?? 0, 0], textColor: o.color ?? '#8a0a0a', fontSize: o.size ?? 0.4, font: o.font ?? '"Comic Sans MS", cursive', solid: false }, o);

  P.trigger = (o = {}) => {
    const z = spawn('zone', { pos: o.pos, size: o.size ?? [2, 2, 2], solid: false, tags: ['trigger', ...(o.tags || [])] }, o);
    const fired = new Set();
    if (o.onEnter) z.on('enter', (p) => {
      if (o.once && fired.size) return;
      if (o.oncePerPlayer && fired.has(p.id)) return;
      fired.add(p.id);
      o.onEnter(p, z);
    });
    if (o.onExit) z.on('exit', (p) => o.onExit(p, z));
    return z;
  };

  P.exit = (o = {}) => {
    const z = P.trigger({ ...o, size: o.size ?? [3, 3, 3] });
    z.active = o.active ?? false;
    z.escaped = new Set();
    z.activate = () => { z.active = true; z.emit('activated'); };
    z.on('enter', (p) => {
      if (!z.active || z.escaped.has(p.id) || !p.alive) return;
      z.escaped.add(p.id);
      if (engine.isHost) p.setData('escaped', true);
      (o.onEscape || ((pl) => pl.toast('You escaped!', 4, '#9fe0a0')))(p, z);
      engine.events.emit('escape', p);
    });
    return z;
  };

  P.generator = (o = {}) => {
    const g = spawn('model', { model: 'generator', pos: o.pos, rot: [0, o.rotY ?? 0, 0], prompt: o.needs ? `Insert ${o.needs}` : o.prompt ?? 'Repair generator', hold: o.needs ? 0 : o.hold ?? 6, holdNoise: o.noise ?? 0.55, solid: true, range: 2.2, tags: ['generator'] }, o);
    g.running = false;
    g.start = (p) => {
      if (g.running) return;
      g.running = true;
      g.set({ prompt: '', glowColor: 0x30ff60, running: true });
      spawn('sound', { sound: 'generator', pos: o.pos, volume: 0.5, range: 14 }, o);
      sfx(g, 'success');
      o.onRepaired?.(p, g);
      g.emit('repaired', p);
      engine.events.emit('repaired', p, g);
    };
    g.on('interact', (p) => {
      if (g.running) return;
      if (o.needs) {
        if (!p.has(o.needs)) { p.toast(`It needs a ${o.needs}.`); p.sound('fail'); return; }
        p.take(o.needs);
      }
      g.start(p);
    });
    return g;
  };

  // The monster. Wanders, investigates noises (including your real voice), chases what it sees.
  P.monster = (o = {}) => {
    const cfg = {
      model: 'stalker', speed: 1.7, chaseSpeed: 4.3, investigateSpeed: 2.8, hearing: 1, sight: 16, fov: 1.15, catchRange: 1.15,
      giveUp: 7, killOnCatch: true, jumpscare: true, opensDoors: true, screech: true, ignoreHidden: true, stunnedByLight: false,
      steps: 'thud', patrol: null, ...o,
    };
    const m = spawn('model', { model: cfg.model, pos: o.pos ?? [0, 0, 0], color: cfg.color, solid: false, steps: cfg.steps, stride: cfg.stride ?? 1.9, ppm: cfg.ppm, stepVolume: cfg.stepVolume ?? 0.9, scale: cfg.scale, tags: ['monster', ...(o.tags || [])] }, o);
    const ai = { state: 'wander', target: null, goal: null, path: null, idx: 0, repath: 0, lastSeen: -99, wait: 0, stun: 0, patrolI: 0, lit: 0 };
    m.ai = ai;
    m.config = cfg;
    const setState = (s, target = null) => {
      if (ai.state === s && ai.target === target) return;
      const prev = ai.state;
      ai.state = s;
      ai.target = target;
      m.set({ anim: s, chasing: s === 'chase' && target ? target.id : null });
      m.emit('state', s, prev, target);
    };
    m.goTo = (pos) => { ai.goal = toV(pos); ai.path = null; setState('investigate'); };
    m.hunt = (player) => { ai.lastSeen = engine.time; setState('chase', player); };
    m.stun = (secs = 3) => { ai.stun = secs; m.emit('stunned'); };
    m.calm = () => { ai.goal = null; ai.path = null; setState('wander'); };
    m.setSpeed = (walk, chase) => { if (walk != null) cfg.speed = walk; if (chase != null) cfg.chaseSpeed = chase; };

    const head = new THREE.Vector3(), eye = new THREE.Vector3();
    m.behave((dt) => {
      if (!engine.isHost && m.net) return; // the host's copy is the real one
      const pos = m.obj.position;
      if (ai.stun > 0) { ai.stun -= dt; return; }
      if (ai.wait > 0) ai.wait -= dt;
      head.set(pos.x, pos.y + 2.0 * (cfg.scale ?? 1), pos.z);
      const yaw = m.rotY;
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

      // senses
      let seen = null, seenD = Infinity, heard = null, heardScore = 0;
      for (const p of engine.players.values()) {
        if (!p.alive || p.role === 'monster') continue;
        const pp = p.isMe ? engine.player.pos : p.pos;
        const hidden = p.isMe ? !!engine.player.hidden : p.hidden;
        const light = p.isMe ? engine.player.light : p.light;
        const noise = p.isMe ? engine.player.noise : p.noise;
        const crouch = p.isMe ? engine.player.crouch : p.crouch;
        eye.set(pp.x, pp.y + (crouch ? 0.9 : 1.5), pp.z);
        const d = head.distanceTo(eye);
        const chasingThis = ai.state === 'chase' && ai.target?.id === p.id;
        if (hidden && cfg.ignoreHidden && !(chasingThis && d < 2.2)) continue;
        const sight = cfg.sight * (light ? 1.7 : 1) * (crouch ? 0.6 : 1) * (chasingThis ? 1.5 : 1);
        if (d < sight) {
          const to = eye.clone().sub(head).setY(0).normalize();
          if ((to.dot(fwd) > Math.cos(cfg.fov) || d < 2.5 || chasingThis) && W.lineOfSight(head, eye) && d < seenD) { seen = p; seenD = d; }
        }
        if (noise > 0.04) {
          const range = noise * 32 * cfg.hearing;
          const walls = W.countBetween(head, eye, 2);
          const eff = range * (walls ? 0.5 : 1);
          if (d < eff && eff - d > heardScore) { heard = { p, pos: pp.clone() }; heardScore = eff - d; }
        }
        // flashlight in the face
        if (cfg.stunnedByLight && light && d < 9) {
          const dir = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
          if (dir.dot(head.clone().sub(eye).setY(0).normalize()) > 0.93 && W.lineOfSight(head, eye)) ai.lit += dt; else ai.lit = Math.max(0, ai.lit - dt * 0.5);
          if (ai.lit > (cfg.lightTime ?? 2)) { ai.lit = 0; m.stun(cfg.stunTime ?? 4); sfx(m, 'screech', { pitch: 1.4 }); setState('wander'); return; }
        }
      }
      if (seen) {
        const h = engine.handle(seen);
        if (ai.state !== 'chase') {
          if (cfg.screech) sfx(m, 'screech', { volume: 1.2 });
          m.emit('spotted', h);
          engine.events.emit('spotted', m, h);
        }
        ai.lastSeen = engine.time;
        setState('chase', h);
      } else if (heard && ai.state !== 'chase') {
        const err = Math.max(0.5, 4 * (1 - heard.p.noise));
        ai.goal = heard.pos.add(new THREE.Vector3((rand() - 0.5) * err, 0, (rand() - 0.5) * err));
        ai.path = null;
        if (ai.state !== 'investigate') { m.emit('heard', engine.handle(heard.p)); engine.events.emit('heard', m, engine.handle(heard.p)); }
        setState('investigate');
      }
      if (ai.state === 'chase') {
        const t = ai.target;
        if (!t || !t.alive || !t.connected || engine.time - ai.lastSeen > cfg.giveUp) {
          ai.goal = t ? toV(t.pos) : null;
          ai.path = null;
          setState(t ? 'investigate' : 'wander');
        } else {
          ai.repath -= dt;
          if (ai.repath <= 0 || !ai.path) { ai.goal = toV(t.pos); ai.path = null; ai.repath = 0.4; }
          if (t.distanceTo({ x: pos.x, y: pos.y, z: pos.z }) < cfg.catchRange + 0.3) return catchPlayer(t);
        }
      }
      if (ai.state === 'wander' && !ai.goal && ai.wait <= 0) {
        if (cfg.patrol?.length) { ai.goal = toV(cfg.patrol[ai.patrolI++ % cfg.patrol.length]); }
        else ai.goal = W.getNav().randomPoint(pos, rand);
        ai.path = null;
      }
      // follow path
      if (ai.goal) {
        if (!ai.path) {
          ai.path = W.getNav().path(pos, ai.goal);
          ai.idx = 0;
          if (!ai.path) { ai.goal = null; ai.wait = 0.5; if (ai.state === 'investigate') setState('wander'); return; }
        }
        const wp = ai.path[Math.min(ai.idx, ai.path.length - 1)];
        const to = new THREE.Vector3(wp.x - pos.x, 0, wp.z - pos.z);
        const dist = to.length();
        const speed = ai.state === 'chase' ? cfg.chaseSpeed : ai.state === 'investigate' ? cfg.investigateSpeed : cfg.speed;
        if (dist < 0.25) {
          ai.idx++;
          if (ai.idx >= ai.path.length) {
            ai.goal = null;
            ai.path = null;
            if (ai.state === 'investigate') { ai.wait = 1.5 + rand() * 2; setState('wander'); m.emit('searched'); }
            else ai.wait = rand() * 2.5;
          }
        } else {
          to.normalize();
          const step = Math.min(dist, speed * dt);
          m.set({ pos: [pos.x + to.x * step, m.y, pos.z + to.z * step] });
          const want = Math.atan2(to.x, to.z);
          let dy = want - m.rotY;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          m.rotY = m.rotY + dy * Math.min(1, dt * 8);
        }
      }
      // smash through doors
      if (cfg.opensDoors) for (const d of W.entities.values()) {
        if (d.kind !== 'door' || d.props.open) continue;
        const [dx, , dz] = d.props.pos;
        const w = d.props.width ?? 1.2, r = d.rotY;
        const cx = dx + Math.cos(r) * w * 0.5, cz = dz - Math.sin(r) * w * 0.5;
        if (Math.hypot(cx - pos.x, cz - pos.z) < 1.3) d.burst ? d.burst() : d.set({ open: true, slam: true });
      }
    });

    function catchPlayer(t) {
      setState('wander');
      ai.goal = null;
      ai.path = null;
      ai.stun = cfg.recover ?? 3;
      m.emit('catch', t);
      engine.events.emit('catch', m, t);
      if (cfg.onCatch) return cfg.onCatch(t, m);
      if (cfg.jumpscare) t.jumpscare(cfg.model);
      if (cfg.killOnCatch) setTimeout(() => t.kill('monster'), cfg.jumpscare ? 900 : 0);
    }
    return m;
  };

  return P;
}
