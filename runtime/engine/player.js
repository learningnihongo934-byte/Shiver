// Local player controller (first person / third person / top-down / ghost flight) and the
// avatars that represent everyone else.
import * as THREE from '/vendor/three/three.module.js';
import { createModel } from './models.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpMin = new THREE.Vector3(), tmpMax = new THREE.Vector3();
const R = 0.3;

export class Controller {
  constructor(engine) {
    this.engine = engine;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.crouch = false;
    this.sprinting = false;
    this.stamina = 1;
    this.exhausted = false;
    this.battery = 1;
    this.light = false;
    this.hidden = null; // locker entity while hiding
    this.frozen = false;
    this.moveNoise = 0;
    this.extraNoise = 0;
    this.noise = 0;
    this.stepDist = 0;
    this.bob = 0;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, buttons: new Set() };
    this.sensitivity = 0.0022;
    this.cameraMode = 'first';
    this.cameraOffset = new THREE.Vector3();
    this.shake = 0;
    this.fovKick = 0;
    this.baseFov = 75;
    this.lookTarget = null;

    const cam = engine.renderer.camera;
    this.flashlight = new THREE.SpotLight(0xfff4dd, 0, 26, 0.48, 0.55, 1.4);
    this.flashlight.position.set(0.15, -0.1, 0);
    this.flashlight.target.position.set(0.05, -0.05, -1);
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.castShadow = true;
    cam.add(this.flashlight, this.flashlight.target);
    this.body = null; // own model in third person / top-down

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('mousemove', (e) => this.onMouse(e));
    addEventListener('mousedown', (e) => { this.mouse.down = true; this.mouse.buttons.add(e.button); engine.events.emit('mousedown', e.button); if (!this.locked() && this.cameraMode !== 'topdown') this.lockPointer(); });
    addEventListener('mouseup', (e) => { this.mouse.down = false; this.mouse.buttons.delete(e.button); engine.events.emit('mouseup', e.button); });
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      const locked = this.locked();
      if (locked) this.lockedAt = performance.now();
      // lock granted then dropped straight away: this browser won't let us keep it, so use drag-to-look
      else if (performance.now() - (this.lockedAt || 0) < 600) { this.noLock = true; document.dispatchEvent(new Event('pointerlockerror')); return; }
      engine.onPointerLock(locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.noLock = true;
      if (this.lockWarned) return;
      this.lockWarned = true;
      engine.ui.toast('Mouse lock is blocked here. Hold the mouse button and drag to look around.', 6);
    });
  }

  locked() { return document.pointerLockElement === document.body; }
  lockPointer() {
    if (this.cameraMode === 'topdown' || !this.engine.started || this.noLock) return;
    const fail = () => document.dispatchEvent(new Event('pointerlockerror'));
    try { const r = document.body.requestPointerLock(); r?.catch?.(fail); } catch { fail(); }
  }

  onKey(e, down) {
    const ui = this.engine.ui;
    if (ui.chatOpen) return;
    const k = e.code;
    if (down) {
      if (!this.keys.has(k)) { this.pressed.add(k); this.engine.events.emit('keydown', k); }
      this.keys.add(k);
    } else {
      this.keys.delete(k);
      this.engine.events.emit('keyup', k);
    }
    if (k === 'Tab' || k === 'Space' || k.startsWith('Arrow')) e.preventDefault();
  }

  onMouse(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.frozen || this.cameraMode === 'topdown' || !this.engine.started) return;
    // Pointer lock is the normal way to look around; if the browser refuses it, drag with the mouse held.
    const locked = this.locked();
    if (!locked && !this.mouse.down) return;
    const s = locked ? this.sensitivity : this.sensitivity * 1.8;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  wasPressed(code) { return this.pressed.has(code); }

  get height() { return this.crouch ? 1.05 : 1.75; }
  get eye() { return this.crouch ? 0.95 : 1.6; }

  setMode(mode) {
    this.cameraMode = ['first', 'third', 'topdown'].includes(mode) ? mode : 'first';
    if (this.cameraMode === 'topdown' && this.locked()) document.exitPointerLock();
    this.updateBody();
  }

  updateBody() {
    const me = this.engine.me;
    const want = (this.cameraMode !== 'first' || this.engine.cine?.cam.on) && !this.engine.config.movie && me ? (me.alive ? me.model || 'humanoid' : 'ghost') : null;
    if (this.bodyModel === want) return;
    this.body?.removeFromParent();
    this.body = null;
    this.bodyModel = want;
    if (want) {
      this.body = createModel(want, { color: me.color });
      this.engine.renderer.scene.add(this.body);
    }
  }

  collide(axis, amount, ignore) {
    const w = this.engine.world;
    this.pos[axis] += amount;
    const H = this.height;
    const box = () => {
      tmpMin.set(this.pos.x - R, this.pos.y, this.pos.z - R);
      tmpMax.set(this.pos.x + R, this.pos.y + H, this.pos.z + R);
    };
    box();
    for (const c of w.boxOverlaps(tmpMin, tmpMax, ignore)) {
      // an earlier push this pass may already have moved us clear
      if (!(tmpMin.x < c.max.x && tmpMax.x > c.min.x && tmpMin.y < c.max.y && tmpMax.y > c.min.y && tmpMin.z < c.max.z && tmpMax.z > c.min.z)) continue;
      if (axis === 'y') {
        if (amount <= 0) { this.pos.y = c.max.y; this.onGround = true; } else this.pos.y = c.min.y - H - 0.001;
        this.vel.y = 0;
      } else {
        const up = c.max.y - this.pos.y;
        if (up <= 0.05 || (up <= 0.42 && this.grounded)) {
          // a floor seam or a step: climb onto it if there's head room
          const old = this.pos.y;
          this.pos.y = c.max.y + 0.001;
          box();
          if (!w.boxOverlaps(tmpMin, tmpMax, ignore).length) continue;
          this.pos.y = old;
          box();
        }
        // push out the shortest way horizontally (never along a long wall to its far end)
        const pushes = [[c.min.x - tmpMax.x, 'x'], [c.max.x - tmpMin.x, 'x'], [c.min.z - tmpMax.z, 'z'], [c.max.z - tmpMin.z, 'z']];
        let best = pushes[0];
        for (const p of pushes) if (Math.abs(p[0]) < Math.abs(best[0])) best = p;
        this.pos[best[1]] += best[0] + Math.sign(best[0]) * 0.001;
        if (Math.sign(this.vel[best[1]]) === -Math.sign(best[0])) this.vel[best[1]] = 0;
      }
      box();
    }
  }

  update(dt) {
    const e = this.engine, cfg = e.config, me = e.me;
    const alive = me ? me.alive : true;
    const ghost = !alive && cfg.ghosts;
    const k = (c) => this.keys.has(c) && !e.ui.chatOpen && !e.ui.noteOpen && !this.frozen;
    const input = new THREE.Vector2((k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0), (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0));
    if (input.lengthSq() > 1) input.normalize();

    if (this.cameraMode === 'topdown') this.aimTopdown();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (this.cameraMode === 'topdown') { fwd.set(0, 0, -1); right.set(1, 0, 0); }

    // crouch / sprint / stamina
    const wantCrouch = !ghost && (k('KeyC') || k('ControlLeft'));
    if (!wantCrouch && this.crouch) {
      tmpMin.set(this.pos.x - R, this.pos.y + 1, this.pos.z - R);
      tmpMax.set(this.pos.x + R, this.pos.y + 1.75, this.pos.z + R);
      if (!e.world.boxOverlaps(tmpMin, tmpMax, ignoreNonSolid).length) this.crouch = false;
    } else this.crouch = wantCrouch;
    const moving = input.lengthSq() > 0.01;
    this.sprinting = cfg.sprint && moving && k('ShiftLeft') && !this.crouch && !this.exhausted && !ghost;
    if (cfg.stamina && !ghost) {
      if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt / (cfg.staminaSeconds || 6));
      else this.stamina = Math.min(1, this.stamina + dt / 8);
      if (this.stamina <= 0.01) this.exhausted = true;
      if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    }
    const speedMul = (me?.speed ?? 1) * (cfg.speed ?? 1);
    const speed = (ghost ? 5 : this.crouch ? cfg.crouchSpeed : this.sprinting ? cfg.sprintSpeed : cfg.walkSpeed) * speedMul;
    const wish = fwd.multiplyScalar(input.y).add(right.multiplyScalar(input.x)).multiplyScalar(speed);

    if (this.hidden || this.frozen) wish.set(0, 0, 0);

    if (ghost) {
      const vy = (k('Space') ? 1 : 0) - (k('KeyC') || k('ShiftLeft') ? 1 : 0);
      this.vel.lerp(new THREE.Vector3(wish.x, vy * 4, wish.z), 1 - Math.exp(-dt * 6));
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = Math.max(-5, Math.min(60, this.pos.y));
      this.onGround = false;
    } else if (!this.hidden) {
      const acc = 1 - Math.exp(-dt * (this.onGround ? 14 : 3));
      this.vel.x += (wish.x - this.vel.x) * acc;
      this.vel.z += (wish.z - this.vel.z) * acc;
      this.vel.y -= (cfg.gravity ?? 20) * dt;
      if (this.onGround && cfg.jump && this.wasPressed('Space') && !this.frozen) { this.vel.y = cfg.jumpSpeed ?? 5.5; this.onGround = false; }
      const wasGround = this.onGround, fallV = this.vel.y;
      this.grounded = wasGround;
      this.onGround = false;
      const ig = ignoreNonSolid;
      const steps = Math.ceil((this.vel.length() * dt) / 0.25) || 1;
      for (let s = 0; s < steps; s++) {
        this.collide('x', (this.vel.x * dt) / steps, ig);
        this.collide('z', (this.vel.z * dt) / steps, ig);
        this.collide('y', (this.vel.y * dt) / steps, ig);
      }
      if (this.onGround && !wasGround && fallV < -6) { this.addNoise(0.5); e.audio.play('step', { volume: 0.7 }); }
      if (this.pos.y < (cfg.killY ?? -40)) e.respawnMe();
      // footsteps
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && hv > 0.5) {
        this.stepDist += hv * dt;
        this.bob += hv * dt * 2.2;
        const stride = this.crouch ? 1.2 : this.sprinting ? 2.4 : 1.8;
        if (this.stepDist > stride) {
          this.stepDist = 0;
          const loud = this.crouch ? 0.06 : this.sprinting ? 0.6 : 0.22;
          this.addNoise(loud);
          e.audio.play('step', { volume: this.crouch ? 0.15 : this.sprinting ? 0.6 : 0.35, soft: this.crouch });
          e.events.emit('step', loud);
        }
      }
    }

    // flashlight
    if (cfg.flashlight && !ghost && this.wasPressed('KeyF') && !e.ui.chatOpen) {
      if (this.battery > 0 || !cfg.battery) { this.light = !this.light; e.audio.play('click'); }
    }
    if (ghost || !cfg.flashlight) this.light = false;
    if (this.light && cfg.battery) {
      this.battery = Math.max(0, this.battery - dt / (cfg.batterySeconds || 300));
      if (this.battery <= 0) { this.light = false; e.audio.play('click'); }
    }
    let lf = this.light ? 1 : 0;
    if (this.light && (this.battery < 0.12 || this.flickerAmount > 0) && Math.random() < 0.15 + (this.flickerAmount || 0) * 0.5) lf = Math.random() * 0.3;
    this.flashlight.intensity = lf * (cfg.flashlightPower ?? 14);
    this.flashlight.castShadow = e.renderer.style.shadows;

    // noise: footsteps + your real voice on the mic + scripted extra
    this.moveNoise *= Math.exp(-dt * 2.5);
    const mic = e.mic.enabled && !e.mic.muted ? Math.min(1, e.mic.level * (cfg.micSensitivity ?? 1)) : 0;
    this.noise = ghost ? 0 : Math.max(this.moveNoise, mic, this.extraNoise);
    this.extraNoise = 0;

    this.updateCamera(dt);
    this.pressed.clear();
  }

  addNoise(v) { this.moveNoise = Math.max(this.moveNoise, v); }

  aimTopdown() {
    const cam = this.engine.renderer.camera;
    const ndc = new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cam);
    const plane = new THREE.Plane(UP, -(this.pos.y + 1));
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) this.yaw = Math.atan2(-(hit.x - this.pos.x), -(hit.z - this.pos.z));
  }

  updateCamera(dt) {
    const e = this.engine, cam = e.renderer.camera;
    const cine = e.cine?.cam.on; // a cutscene is directing the camera
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * this.shake;
    const jitter = () => (Math.random() - 0.5) * sh * 0.3;
    this.fovKick += ((this.sprinting ? 7 : 0) - this.fovKick) * Math.min(1, dt * 5);
    if (!cine) { cam.fov = this.baseFov + this.fovKick; cam.updateProjectionMatrix(); cam.up.set(0, 1, 0); }
    const eye = this.pos.clone();
    eye.y += this.hidden ? 1.55 : this.eye;
    const ghost = e.me && !e.me.alive;
    if (!ghost && this.onGround) eye.y += Math.sin(this.bob * Math.PI) * (this.sprinting ? 0.06 : 0.035);
    if (this.lookTarget) {
      // forced look (jumpscares)
      const d = new THREE.Vector3().subVectors(this.lookTarget, eye);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    if (cine) {
      e.cine.applyCamera(cam);
      cam.position.x += jitter(); cam.position.y += jitter();
      this.flashlight.intensity = 0;
    } else if (this.cameraMode === 'first') {
      cam.position.copy(eye);
      cam.rotation.set(this.pitch + jitter(), this.yaw + jitter(), jitter() * 0.5, 'YXZ');
      this.flashlight.position.set(0.15, -0.1, 0);
    } else if (this.cameraMode === 'third') {
      const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch) + 0.25, Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
      const hit = e.world.raycast(eye, back, 3.2, ignoreNonSolid);
      const dist = hit ? Math.max(0.3, hit.distance - 0.2) : 3.2;
      cam.position.copy(eye).addScaledVector(back, dist);
      cam.rotation.set(this.pitch + jitter(), this.yaw + jitter(), 0, 'YXZ');
    } else {
      const h = e.config.topdownHeight ?? 16;
      cam.position.set(this.pos.x + jitter(), this.pos.y + h, this.pos.z + h * 0.45 + jitter());
      cam.lookAt(this.pos.x, this.pos.y, this.pos.z);
      this.flashlight.position.set(0, 0, 0);
    }
    if (this.cameraMode !== 'first' && !cine) {
      // flashlight comes from the body, aimed where the player faces
      const origin = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch) - (this.cameraMode === 'topdown' ? 0.25 : 0), -Math.cos(this.yaw) * Math.cos(this.pitch));
      cam.updateMatrixWorld();
      this.flashlight.position.copy(cam.worldToLocal(origin.clone()));
      this.flashlight.target.position.copy(cam.worldToLocal(origin.add(dir)));
    } else this.flashlight.target.position.set(0.05, -0.05, -1);
    this.updateBody();
    if (this.body) {
      this.body.position.copy(this.pos);
      this.body.rotation.y = this.yaw + Math.PI;
      this.body.visible = !this.hidden;
      this.body.userData.animate?.(e.time, { speed: Math.hypot(this.vel.x, this.vel.z), dt });
    }
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    e.audio.setListener(cam.position, fwd, UP);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}

export const ignoreNonSolid = (ent) => ent.props.playerPass === true;

// ---------------------------------------------------------------- other players
export class Avatars {
  constructor(engine) {
    this.engine = engine;
    this.map = new Map();
    // pooled spotlights so other players' flashlights light the world too
    this.spots = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.SpotLight(0xfff4dd, 0, 22, 0.45, 0.55, 1.4);
      engine.renderer.scene.add(s, s.target);
      this.spots.push(s);
    }
  }

  update(dt, t) {
    const e = this.engine;
    const meGhost = e.me && !e.me.alive;
    const cam = e.renderer.camera;
    const withLight = [];
    for (const p of e.players.values()) {
      if (p.isMe) continue;
      let a = this.map.get(p.id);
      const wantModel = p.alive ? p.model || 'humanoid' : 'ghost';
      if (!a || a.modelName !== wantModel) {
        a?.obj.removeFromParent();
        const obj = createModel(wantModel, { color: p.color });
        e.renderer.scene.add(obj);
        a = { obj, modelName: wantModel, pos: p.pos.clone(), yaw: p.yaw };
        this.map.set(p.id, a);
      }
      const k = 1 - Math.exp(-dt * 14);
      if (a.pos.distanceTo(p.pos) > 8) a.pos.copy(p.pos);
      const before = a.pos.clone();
      a.pos.lerp(p.pos, k);
      let dy = p.yaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * k;
      a.obj.position.copy(a.pos);
      if (p.crouch && p.alive) a.obj.scale.set(1, 0.65, 1); else a.obj.scale.set(1, 1, 1);
      a.obj.rotation.y = a.yaw + Math.PI;
      const sp = before.distanceTo(a.pos) / Math.max(dt, 1e-4);
      a.speed = (a.speed || 0) * 0.8 + sp * 0.2;
      a.obj.userData.animate?.(t, { speed: a.speed, dt });
      if (a.obj.userData.head) a.obj.userData.head.rotation.x = -(p.pitch || 0) * 0.6;
      // ghosts are only visible to other ghosts (or everyone if the game says so)
      const visible = !p.hidden && (p.alive || meGhost || e.config.ghostsVisible) && p.visible !== false;
      a.obj.visible = visible;
      if (p.light && p.alive && !p.hidden) withLight.push(p);
      // name tag
      const head = a.pos.clone();
      head.y += p.alive ? (p.model === 'stalker' ? 2.9 : 2.05) : 2.2;
      const proj = head.clone().project(cam);
      const dist = cam.position.distanceTo(head);
      const onScreen = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
      const showTag = visible && onScreen && dist < (e.config.nameTagRange ?? 14) && e.config.nameTags !== false && (e.world.lineOfSight(cam.position, head) || dist < 3);
      e.ui.label(p.id, p.name, ((proj.x + 1) / 2) * innerWidth, ((1 - proj.y) / 2) * innerHeight, showTag, p.speaking);
    }
    for (const [id, a] of this.map) if (!e.players.has(id)) { a.obj.removeFromParent(); this.map.delete(id); e.ui.dropLabel(id); }
    // assign flashlights
    withLight.sort((a, b) => a.pos.distanceToSquared(cam.position) - b.pos.distanceToSquared(cam.position));
    this.spots.forEach((s, i) => {
      const p = withLight[i];
      if (!p) { s.intensity = 0; return; }
      const a = this.map.get(p.id);
      s.position.copy(a.pos).add(new THREE.Vector3(0, 1.45, 0));
      const pitch = p.pitch || 0;
      s.target.position.copy(s.position).add(new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(p.yaw) * Math.cos(pitch)));
      s.intensity = 12;
    });
  }

  clear() {
    for (const [id, a] of this.map) { a.obj.removeFromParent(); this.engine.ui.dropLabel(id); }
    this.map.clear();
  }
}
