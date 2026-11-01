// Built-in low-poly models made from primitives. Each returns a THREE.Group; groups may have
// userData.animate(t, state) for idle/walk animation and userData.eyes for glowing bits.
import * as THREE from '/vendor/three/three.module.js';
import { material, boxGeometry, getAsset, assetTexture, snapify } from './textures.js';

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(boxGeometry(w, h, d, 1), mat);
  m.position.set(x, y, z);
  return m;
};
const cyl = (r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 8) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  return m;
};
const limb = (w, h, d, mat, px, py, pz) => {
  // pivot at the top so it swings like a joint
  const pivot = new THREE.Group();
  pivot.position.set(px, py, pz);
  pivot.add(box(w, h, d, mat, 0, -h / 2, 0));
  return pivot;
};
const glow = (c, i = 3) => material({ color: c, emissive: c, emissiveIntensity: i });

const MODELS = {
  humanoid({ color = 0x3d5a80, skin = 0xd9a77c } = {}) {
    const g = new THREE.Group();
    const shirt = material({ color }), pants = material({ color: 0x23262b }), sk = material({ color: skin });
    const torso = box(0.46, 0.62, 0.26, shirt, 0, 1.12, 0);
    const head = box(0.3, 0.32, 0.3, sk, 0, 1.62, 0);
    head.add(box(0.06, 0.04, 0.02, material({ color: 0x111111 }), -0.07, 0.03, 0.16), box(0.06, 0.04, 0.02, material({ color: 0x111111 }), 0.07, 0.03, 0.16));
    const la = limb(0.13, 0.58, 0.13, shirt, -0.31, 1.4, 0), ra = limb(0.13, 0.58, 0.13, shirt, 0.31, 1.4, 0);
    const ll = limb(0.17, 0.8, 0.18, pants, -0.12, 0.81, 0), rl = limb(0.17, 0.8, 0.18, pants, 0.12, 0.81, 0);
    g.add(torso, head, la, ra, ll, rl);
    g.userData.head = head;
    g.userData.animate = walker(la, ra, ll, rl, 0.7);
    return g;
  },
  stalker({ color = 0x0b0b0d } = {}) {
    const g = new THREE.Group();
    const skin = material({ color }), face = material({ color: 0xc9c2b4 });
    g.add(box(0.36, 0.9, 0.2, skin, 0, 1.75, 0));
    const head = box(0.3, 0.42, 0.28, face, 0, 2.45, 0.02);
    const eyeL = box(0.07, 0.05, 0.02, glow(0xffffff, 6), -0.07, 0.05, 0.15), eyeR = box(0.07, 0.05, 0.02, glow(0xffffff, 6), 0.07, 0.05, 0.15);
    head.add(eyeL, eyeR, box(0.16, 0.04, 0.02, material({ color: 0x110000 }), 0, -0.11, 0.15));
    const la = limb(0.08, 1.25, 0.08, skin, -0.24, 2.15, 0), ra = limb(0.08, 1.25, 0.08, skin, 0.24, 2.15, 0);
    const ll = limb(0.1, 1.3, 0.1, skin, -0.1, 1.3, 0), rl = limb(0.1, 1.3, 0.1, skin, 0.1, 1.3, 0);
    g.add(head, la, ra, ll, rl);
    g.userData.head = head;
    g.userData.eyes = [eyeL, eyeR];
    const walk = walker(la, ra, ll, rl, 0.5);
    g.userData.animate = (t, st) => {
      walk(t, st);
      head.rotation.z = Math.sin(t * 13) * 0.04 + (Math.random() < 0.02 ? (Math.random() - 0.5) * 0.6 : 0);
      la.rotation.z = -0.08; ra.rotation.z = 0.08;
    };
    return g;
  },
  crawler({ color = 0x2a1f1a } = {}) {
    const g = new THREE.Group();
    const skin = material({ color }), pale = material({ color: 0xb8ab95 });
    g.add(box(0.5, 0.3, 1.0, skin, 0, 0.55, 0));
    const head = box(0.32, 0.3, 0.32, pale, 0, 0.6, 0.62);
    head.add(box(0.05, 0.05, 0.02, glow(0xff2a1a, 5), -0.08, 0.04, 0.17), box(0.05, 0.05, 0.02, glow(0xff2a1a, 5), 0.08, 0.04, 0.17));
    g.add(head);
    const legs = [];
    for (const z of [-0.35, 0, 0.35]) for (const s of [-1, 1]) {
      const l = limb(0.07, 0.75, 0.07, skin, s * 0.28, 0.65, z);
      l.rotation.z = s * 0.9;
      legs.push(l);
      g.add(l);
    }
    g.userData.head = head;
    g.userData.animate = (t, st) => {
      const sp = Math.min(1, st.speed / 3);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 14 + i * 1.7) * 0.5 * sp));
      head.rotation.y = Math.sin(t * 3) * 0.3;
    };
    return g;
  },
  grinner() {
    const g = new THREE.Group();
    const face = material({ color: 0x0a0a0a });
    const head = box(0.6, 0.6, 0.3, face, 0, 1.7, 0);
    head.add(box(0.12, 0.08, 0.02, glow(0xfff6d0, 8), -0.14, 0.1, 0.16), box(0.12, 0.08, 0.02, glow(0xfff6d0, 8), 0.14, 0.1, 0.16));
    for (let i = 0; i < 9; i++) head.add(box(0.045, 0.09, 0.02, glow(0xfff6d0, 6), -0.2 + i * 0.05, -0.12 - Math.sin((i / 8) * Math.PI) * 0.06, 0.16));
    g.add(head);
    g.userData.head = head;
    g.userData.animate = (t) => { head.position.y = 1.7 + Math.sin(t * 1.3) * 0.08; head.rotation.z = Math.sin(t * 0.7) * 0.15; };
    return g;
  },
  doll() {
    const g = new THREE.Group();
    const porcelain = material({ color: 0xe8ded0 }), dress = material({ color: 0x5a1820 });
    g.add(cyl(0.12, 0.22, 0.45, dress, 0, 0.32, 0));
    const head = box(0.22, 0.22, 0.2, porcelain, 0, 0.68, 0);
    head.add(box(0.04, 0.04, 0.02, material({ color: 0x050505 }), -0.05, 0.02, 0.11), box(0.04, 0.04, 0.02, material({ color: 0x050505 }), 0.05, 0.02, 0.11));
    head.add(box(0.26, 0.1, 0.24, material({ color: 0x2b1a10 }), 0, 0.1, -0.02));
    g.add(head);
    g.userData.head = head;
    g.userData.animate = (t, st) => { head.rotation.z = st.speed > 0.1 ? Math.sin(t * 20) * 0.2 : 0.25; };
    return g;
  },
  ghost({ color = 0xcfd8ff } = {}) {
    const g = new THREE.Group();
    const m = material({ color, opacity: 0.35, emissive: color, emissiveIntensity: 0.4 });
    const body = cyl(0.25, 0.45, 1.5, m, 0, 0.95, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), m);
    head.position.y = 1.75;
    head.add(box(0.06, 0.1, 0.02, material({ color: 0x000000, opacity: 0.8 }), -0.08, 0, 0.26), box(0.06, 0.1, 0.02, material({ color: 0x000000, opacity: 0.8 }), 0.08, 0, 0.26));
    g.add(body, head);
    g.userData.head = head;
    g.userData.animate = (t) => { g.children[0].position.y = 0.95 + Math.sin(t * 2) * 0.08; head.position.y = 1.75 + Math.sin(t * 2) * 0.08; };
    return g;
  },
  key() {
    const g = new THREE.Group();
    const m = material({ color: 0xc9a227, metal: 0.8, rough: 0.4, emissive: 0x332200 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 4, 10), m);
    ring.position.y = 0.12;
    g.add(ring, box(0.02, 0.18, 0.02, m, 0, -0.0, 0), box(0.05, 0.02, 0.02, m, 0.025, -0.06, 0), box(0.04, 0.02, 0.02, m, 0.02, -0.02, 0));
    return g;
  },
  fuse() {
    const g = new THREE.Group();
    g.add(cyl(0.05, 0.05, 0.2, glow(0x3ec7ff, 1.5), 0, 0, 0), cyl(0.055, 0.055, 0.04, material({ color: 0xaaaaaa, metal: 0.8 }), 0, 0.1, 0), cyl(0.055, 0.055, 0.04, material({ color: 0xaaaaaa, metal: 0.8 }), 0, -0.1, 0));
    g.rotation.z = Math.PI / 2;
    return g;
  },
  battery() {
    const g = new THREE.Group();
    g.add(cyl(0.04, 0.04, 0.16, material({ color: 0x1f8a3a }), 0, 0, 0), cyl(0.041, 0.041, 0.05, material({ color: 0x111111 }), 0, -0.06, 0), cyl(0.015, 0.015, 0.02, material({ color: 0xcccccc, metal: 1 }), 0, 0.09, 0));
    return g;
  },
  radio() {
    const g = new THREE.Group();
    g.add(box(0.12, 0.22, 0.06, material({ color: 0x222222 })), cyl(0.01, 0.01, 0.16, material({ color: 0x111111 }), 0.04, 0.18, 0), box(0.02, 0.02, 0.01, glow(0xff3020, 4), -0.03, 0.08, 0.035));
    return g;
  },
  note() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), material({ texture: 'paper', double: true }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.01;
    g.add(m);
    return g;
  },
  generator({ color = 0x5c6e3a } = {}) {
    const g = new THREE.Group();
    const body = material({ color, metal: 0.4, rough: 0.6 }), dark = material({ color: 0x1b1b1b });
    g.add(box(1.0, 0.7, 0.6, body, 0, 0.45, 0), box(1.1, 0.08, 0.7, dark, 0, 0.06, 0), cyl(0.12, 0.12, 0.3, dark, 0.3, 0.9, 0), box(0.3, 0.2, 0.02, dark, -0.2, 0.5, 0.31));
    const lamp = box(0.08, 0.08, 0.04, glow(0xff2020, 2), -0.2, 0.62, 0.31);
    g.add(lamp);
    g.userData.lamp = lamp;
    return g;
  },
  locker({ color = 0x4a5a63 } = {}) {
    const g = new THREE.Group();
    const m = material({ texture: 'metal', color });
    g.add(box(0.7, 2.0, 0.6, m, 0, 1.0, 0));
    for (let i = 0; i < 4; i++) g.add(box(0.4, 0.02, 0.02, material({ color: 0x111111 }), 0, 1.6 + i * 0.06, 0.31));
    g.add(box(0.04, 0.12, 0.03, material({ color: 0x999999, metal: 1 }), 0.26, 1.05, 0.32));
    return g;
  },
  bed() {
    const g = new THREE.Group();
    const frame = material({ color: 0x8a8f91, metal: 0.6, rough: 0.5 });
    g.add(box(0.9, 0.18, 2.0, material({ color: 0xbab7aa }), 0, 0.55, 0), box(0.92, 0.05, 2.02, frame, 0, 0.44, 0), box(0.6, 0.1, 0.35, material({ color: 0xe0ddd0 }), 0, 0.68, -0.75));
    for (const [x, z] of [[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]]) g.add(box(0.05, 0.45, 0.05, frame, x, 0.22, z));
    g.add(box(0.9, 0.5, 0.04, frame, 0, 0.75, -1.0));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), material({ texture: 'blood' })).translateY(0.65).translateZ(0.2).rotateX(-Math.PI / 2));
    return g;
  },
  wheelchair() {
    const g = new THREE.Group();
    const frame = material({ color: 0x777777, metal: 0.7, rough: 0.4 }), seat = material({ color: 0x1a1a22 });
    g.add(box(0.5, 0.06, 0.45, seat, 0, 0.5, 0), box(0.5, 0.5, 0.06, seat, 0, 0.78, -0.22));
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 14), frame);
      w.position.set(s * 0.3, 0.32, -0.05);
      w.rotation.y = Math.PI / 2;
      g.add(w);
    }
    return g;
  },
  desk() {
    const g = new THREE.Group();
    const w = material({ texture: 'wood', color: 0x9a8a78 });
    g.add(box(1.4, 0.06, 0.7, w, 0, 0.75, 0), box(0.06, 0.72, 0.66, w, -0.66, 0.36, 0), box(0.06, 0.72, 0.66, w, 0.66, 0.36, 0), box(1.3, 0.4, 0.04, w, 0, 0.5, -0.3));
    return g;
  },
  chair() {
    const g = new THREE.Group();
    const w = material({ texture: 'wood', color: 0x8a7a68 });
    g.add(box(0.45, 0.05, 0.45, w, 0, 0.45, 0), box(0.45, 0.5, 0.05, w, 0, 0.72, -0.2));
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(box(0.04, 0.45, 0.04, w, x, 0.22, z));
    return g;
  },
  shelf() {
    const g = new THREE.Group();
    const m = material({ texture: 'metal', color: 0x6a6a6a });
    for (const x of [-0.58, 0.58]) g.add(box(0.04, 2.0, 0.4, m, x, 1.0, 0));
    for (let i = 0; i < 4; i++) g.add(box(1.2, 0.03, 0.4, m, 0, 0.15 + i * 0.6, 0));
    const junk = [0x7a5a3a, 0x3a4a5a, 0x5a3a3a, 0x8a8a6a];
    for (let i = 0; i < 6; i++) g.add(box(0.2 + (i % 3) * 0.08, 0.2 + (i % 2) * 0.15, 0.25, material({ color: junk[i % 4] }), -0.4 + (i % 3) * 0.38, 0.28 + Math.floor(i / 3) * 0.6 + 0.08, 0));
    return g;
  },
  lamp() {
    // fluorescent ceiling fixture; the light itself is a separate light entity
    const g = new THREE.Group();
    g.add(box(1.2, 0.05, 0.25, material({ color: 0x777777 }), 0, 0, 0));
    const tube = box(1.1, 0.04, 0.1, glow(0xf4f1dc, 2.5), 0, -0.04, 0);
    g.add(tube);
    g.userData.glow = tube;
    return g;
  },
  bulb() {
    const g = new THREE.Group();
    g.add(cyl(0.005, 0.005, 0.5, material({ color: 0x111111 }), 0, 0.25, 0));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), glow(0xffd9a0, 3));
    g.add(b);
    g.userData.glow = b;
    return g;
  },
  barrel() {
    const g = new THREE.Group();
    g.add(cyl(0.3, 0.3, 0.9, material({ texture: 'rust', color: 0xaa8866 }), 0, 0.45, 0, 10));
    return g;
  },
  crate() {
    const g = new THREE.Group();
    g.add(box(0.8, 0.8, 0.8, material({ texture: 'wood' }), 0, 0.4, 0));
    return g;
  },
  tree() {
    const g = new THREE.Group();
    const bark = material({ color: 0x241a12 });
    g.add(cyl(0.12, 0.22, 4.5, bark, 0, 2.25, 0, 6));
    for (let i = 0; i < 5; i++) {
      const b = cyl(0.03, 0.07, 1.8, bark, 0, 0, 0, 5);
      b.position.set(Math.cos(i * 1.3) * 0.4, 2.8 + i * 0.35, Math.sin(i * 1.3) * 0.4);
      b.rotation.set(Math.sin(i * 1.3) * 0.9, 0, -Math.cos(i * 1.3) * 0.9);
      g.add(b);
    }
    return g;
  },
  gravestone() {
    const g = new THREE.Group();
    const m = material({ texture: 'stone', color: 0x9a9a9a });
    g.add(box(0.6, 0.9, 0.16, m, 0, 0.45, 0), cyl(0.3, 0.3, 0.16, m, 0, 0.9, 0, 10).rotateX(Math.PI / 2));
    g.rotation.z = (Math.random() - 0.5) * 0.15;
    return g;
  },
  cross() {
    const g = new THREE.Group();
    const m = material({ texture: 'wood', color: 0x6a5a4a });
    g.add(box(0.1, 1.3, 0.1, m, 0, 0.65, 0), box(0.6, 0.1, 0.1, m, 0, 1.0, 0));
    return g;
  },
  fence() {
    const g = new THREE.Group();
    const m = material({ color: 0x1a1a1a, metal: 0.6 });
    g.add(box(2.0, 0.05, 0.05, m, 0, 1.1, 0), box(2.0, 0.05, 0.05, m, 0, 0.3, 0));
    for (let i = 0; i < 9; i++) g.add(box(0.04, 1.4, 0.04, m, -0.95 + i * 0.237, 0.7, 0));
    return g;
  },
  candle() {
    const g = new THREE.Group();
    g.add(cyl(0.035, 0.035, 0.2, material({ color: 0xe8e0c8 }), 0, 0.1, 0));
    const flame = box(0.025, 0.05, 0.025, glow(0xffaa33, 6), 0, 0.23, 0);
    g.add(flame);
    g.userData.glow = flame;
    g.userData.animate = (t) => { flame.scale.y = 0.8 + Math.sin(t * 17) * 0.2 + Math.random() * 0.15; };
    return g;
  },
  tv() {
    const g = new THREE.Group();
    g.add(box(0.7, 0.55, 0.5, material({ color: 0x2a2620 }), 0, 0.28, 0));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.4), material({ texture: 'static', unlit: true, color: 0xbbbbbb }));
    screen.position.set(0, 0.3, 0.251);
    g.add(screen);
    g.userData.glow = screen;
    return g;
  },
  toilet() {
    const g = new THREE.Group();
    const m = material({ color: 0xd8d4c8, rough: 0.4 });
    g.add(cyl(0.18, 0.15, 0.4, m, 0, 0.2, 0.05, 10), box(0.4, 0.4, 0.18, m, 0, 0.6, -0.2));
    return g;
  },
  pillar() {
    const g = new THREE.Group();
    g.add(box(0.5, 3, 0.5, material({ texture: 'concrete' }), 0, 1.5, 0));
    return g;
  },
};

function walker(la, ra, ll, rl, amp) {
  let phase = 0;
  return (t, st) => {
    const sp = Math.min(1.5, (st.speed || 0) / 2.5);
    phase += (st.dt || 0.016) * (4 + (st.speed || 0) * 2.2);
    const s = Math.sin(phase) * amp * sp;
    la.rotation.x = s; ra.rotation.x = -s; ll.rotation.x = -s; rl.rotation.x = s;
  };
}

export const MODEL_NAMES = Object.keys(MODELS);

// Pixeter art as a "model": a billboard that always faces the camera (Doom style), lit by the
// flashlight, playing the sprite's animation tags (idle / walk / run / chase / ...).
function spriteModel(a, opts) {
  const base = assetTexture(a.name);
  const tex = base.clone();
  base.clones.push(tex);
  if (base.image.complete && base.image.naturalWidth) tex.needsUpdate = true;
  tex.repeat.set(1 / a.cols, 1 / a.rows);
  const ppm = opts.ppm || 16; // pixels per metre: a 32px-tall sprite is 2m tall
  const w = a.w / ppm, h = a.h / ppm;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), snapify(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 })));
  plane.position.y = h / 2;
  plane.castShadow = true;
  const g = new THREE.Group();
  g.add(plane);
  const head = new THREE.Object3D();
  head.position.y = h * 0.85;
  g.add(head);
  g.userData.head = head;
  g.userData.height = h;
  const q = new THREE.Quaternion(), e = new THREE.Euler(), wp = new THREE.Vector3();
  plane.onBeforeRender = (r, s, cam) => {
    plane.getWorldPosition(wp);
    g.getWorldQuaternion(q);
    e.setFromQuaternion(q, 'YXZ');
    plane.rotation.y = Math.atan2(cam.position.x - wp.x, cam.position.z - wp.z) - e.y;
    plane.updateMatrixWorld();
  };
  const frames = a.frames?.length ? a.frames : [100];
  const all = frames.map((_, i) => i);
  const seqOf = (t) => {
    let f = [];
    for (let i = Math.max(0, t.from); i <= Math.min(frames.length - 1, t.to); i++) f.push(i);
    if (t.dir === 'reverse') f.reverse();
    if (t.dir === 'pingpong' && f.length > 2) f = f.concat(f.slice(1, -1).reverse());
    return f.length ? f : all;
  };
  const tags = new Map((a.tags || []).map((t) => [t.name.toLowerCase(), seqOf(t)]));
  const pick = (names) => { for (const n of names) if (n && tags.has(n)) return tags.get(n); return null; };
  const show = (i) => tex.offset.set((i % a.cols) / a.cols, 1 - (Math.floor(i / a.cols) + 1) / a.rows);
  let seq = all, idx = 0, acc = 0;
  show(0);
  g.userData.animate = (t, st) => {
    const moving = (st.speed || 0) > 0.3;
    const want = String(opts.anim || st.state || '').toLowerCase();
    const next = pick([want, ...(moving ? (st.speed > 3.5 ? ['run', 'chase', 'walk', 'move'] : ['walk', 'move', 'run']) : ['idle', 'stand'])]) || all;
    if (next !== seq) { seq = next; idx = 0; acc = 0; }
    acc += (st.dt || 0.016) * 1000;
    while (acc >= frames[seq[idx]]) { acc -= frames[seq[idx]]; idx = (idx + 1) % seq.length; }
    show(seq[idx]);
  };
  return g;
}

export function createModel(name, opts = {}) {
  if (typeof name === 'string' && name.startsWith('asset:')) {
    const a = getAsset(name.slice(6));
    if (a) return spriteModel(a, opts);
    console.warn(`No asset called "${name.slice(6)}". Import it in the Studio's Assets panel.`);
  }
  const make = MODELS[name] || MODELS.crate;
  const g = make(opts);
  g.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
}
