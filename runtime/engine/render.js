// Renderer: draws the scene into a (usually low-res) target, then a post shader adds the look:
// dithering, VHS tracking, film grain, chromatic aberration, noir, thermal vision, flashes, fades.
import * as THREE from '/vendor/three/three.module.js';

export const STYLES = {
  retro: { height: 240, levels: 20, dither: 1, grain: 0.05, chroma: 0, scan: 0, vignette: 0.6, mono: 0, contrast: 1.05, tracking: 0, snap: 1, shadows: false, fog: 0.085, exposure: 1.1 },
  vhs: { height: 360, levels: 0, dither: 0, grain: 0.11, chroma: 1.3, scan: 0.35, vignette: 0.7, mono: 0, contrast: 1.1, tracking: 1, snap: 0, shadows: false, fog: 0.07, exposure: 1.15, stamp: true },
  hd: { height: 0, levels: 0, dither: 0, grain: 0.035, chroma: 0.25, scan: 0, vignette: 0.55, mono: 0, contrast: 1.0, tracking: 0, snap: 0, shadows: true, fog: 0.055, exposure: 1.0, tonemap: true },
  noir: { height: 480, levels: 0, dither: 0, grain: 0.14, chroma: 0, scan: 0, vignette: 0.8, mono: 1, contrast: 1.45, tracking: 0, snap: 0, shadows: true, fog: 0.07, exposure: 1.2 },
  pixel: { height: 180, levels: 10, dither: 0.6, grain: 0.0, chroma: 0, scan: 0, vignette: 0.35, mono: 0, contrast: 1.1, tracking: 0, snap: 0, shadows: false, fog: 0.03, exposure: 1.25 },
};

const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime, uLevels, uDither, uGrain, uChroma, uScan, uVignette, uMono, uContrast, uTracking, uThermal, uFade, uGlitch, uDamage, uExposure, uTonemap;
uniform vec4 uFlash;
varying vec2 vUv;
float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  vec2 px = floor(uv * uRes);
  if (uTracking > 0.0) {
    float line = floor(uv.y * uRes.y / 2.0);
    uv.x += (rand(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.0025 * uTracking;
    float band = abs(fract(uv.y * 0.6 - uTime * 0.05) - 0.5);
    uv.x += (1.0 - smoothstep(0.0, 0.03, band)) * 0.012 * uTracking;
  }
  if (uGlitch > 0.0) {
    float g = step(1.0 - uGlitch * 0.35, rand(vec2(floor(uv.y * 30.0), floor(uTime * 25.0))));
    uv.x += g * (rand(vec2(floor(uTime * 25.0), 3.0)) - 0.5) * 0.15 * uGlitch;
  }
  vec3 col;
  if (uChroma > 0.0) {
    vec2 off = (uv - 0.5) * uChroma * 0.008 + vec2(uChroma * 0.0012, 0.0);
    col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }
  col *= uExposure;
  col = uTonemap > 0.5 ? aces(col) : clamp(col, 0.0, 1.0);
  col = toSRGB(col);
  if (uThermal > 0.0) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 th = mix(vec3(0.02, 0.0, 0.12), vec3(0.85, 0.05, 0.25), smoothstep(0.02, 0.25, l));
    th = mix(th, vec3(1.0, 0.85, 0.2), smoothstep(0.25, 0.7, l));
    col = mix(col, th, uThermal);
  }
  col = (col - 0.5) * uContrast + 0.5;
  if (uMono > 0.0) col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uMono);
  col += (rand(px + fract(uTime * 7.13) * 100.0) - 0.5) * uGrain;
  col *= 1.0 - uScan * 0.5 * (0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159));
  vec2 d = vUv - 0.5;
  col *= 1.0 - uVignette * dot(d, d) * 2.0;
  col = mix(col, vec3(0.45, 0.0, 0.0), uDamage * smoothstep(0.15, 0.75, length(d) * 1.4));
  if (uLevels > 0.0) {
    float b = (bayer4(px) - 0.5) * uDither;
    col = floor(clamp(col, 0.0, 1.0) * uLevels + b + 0.5) / uLevels;
  }
  col = mix(col, uFlash.rgb, uFlash.a);
  col *= 1.0 - uFade;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Shared uniform used by every engine material for PS1-style vertex wobble.
export const SNAP = { value: new THREE.Vector2(0, 0) };

export class Renderer {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.gl.setPixelRatio(1);
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020203);
    this.scene.fog = new THREE.FogExp2(0x020203, 0.08);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight(0x8890a0, 0x201810, 0.08);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x8090c0, 0);
    this.moon.position.set(-30, 50, 20);
    this.scene.add(this.moon, this.moon.target);

    // Fixed pool of point lights; world lights borrow the nearest ones each frame (no shader recompiles).
    this.pool = [];
    for (let i = 0; i < 10; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      this.scene.add(l);
      this.pool.push(l);
    }
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uLevels: { value: 0 }, uDither: { value: 0 }, uGrain: { value: 0 }, uChroma: { value: 0 }, uScan: { value: 0 },
        uVignette: { value: 0 }, uMono: { value: 0 }, uContrast: { value: 1 }, uTracking: { value: 0 }, uThermal: { value: 0 },
        uFade: { value: 0 }, uGlitch: { value: 0 }, uDamage: { value: 0 }, uExposure: { value: 1 }, uTonemap: { value: 0 },
        uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.overrides = {};
    this.effects = { flash: 0, flashColor: new THREE.Color(1, 1, 1), fade: 0, fadeTarget: 0, fadeSpeed: 1, glitch: 0, damage: 0, thermal: 0, shake: 0 };
    this.setStyle('retro');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setStyle(name, overrides = {}) {
    if (!STYLES[name]) name = 'retro';
    const wasShadows = this.style?.shadows;
    this.styleName = name;
    this.style = { ...STYLES[name], ...overrides };
    const s = this.style;
    const u = this.post.uniforms;
    for (const [k, key] of [['levels', 'uLevels'], ['dither', 'uDither'], ['grain', 'uGrain'], ['chroma', 'uChroma'], ['scan', 'uScan'], ['vignette', 'uVignette'], ['mono', 'uMono'], ['contrast', 'uContrast'], ['tracking', 'uTracking'], ['exposure', 'uExposure']]) u[key].value = s[k];
    u.uTonemap.value = s.tonemap ? 1 : 0;
    this.gl.shadowMap.enabled = !!s.shadows;
    if (this.scene.fog && s.fog != null && !this.fogLocked) this.scene.fog.density = s.fog;
    const filter = s.height && s.height < 400 ? THREE.NearestFilter : THREE.LinearFilter;
    this.target.texture.minFilter = this.target.texture.magFilter = filter;
    this.target.texture.needsUpdate = true;
    if (wasShadows !== s.shadows) this.scene.traverse((o) => o.material && (o.material.needsUpdate = true));
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const s = this.style || STYLES.retro;
    const ih = s.height ? Math.min(s.height, h) : Math.round(h * Math.min(devicePixelRatio, 1.5));
    const iw = Math.max(1, Math.round((ih * w) / h));
    this.target.setSize(iw, ih);
    this.post.uniforms.uRes.value.set(iw, ih);
    SNAP.value.set(s.snap ? iw / 4 : 0, s.snap ? ih / 4 : 0);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.camera.isOrthographicCamera) this.updateOrtho?.();
  }

  // lights: [{pos: Vector3, color: Color, intensity, range}] (already flicker-adjusted)
  assignLights(lights, from) {
    const sorted = lights
      .filter((l) => l.intensity > 0.001)
      .map((l) => [l, l.pos.distanceToSquared(from) / (l.range * l.range)])
      .sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      const l = sorted[i]?.[0];
      if (!l) { p.intensity = 0; continue; }
      p.position.copy(l.pos);
      p.color.copy(l.color);
      p.intensity = l.intensity;
      p.distance = l.range;
    }
  }

  flash(color = 0xffffff, amount = 1) {
    this.effects.flashColor.set(color);
    this.effects.flash = amount;
  }

  render(dt, time) {
    const e = this.effects;
    const u = this.post.uniforms;
    u.uTime.value = time;
    e.flash = Math.max(0, e.flash - dt * 2.5);
    u.uFlash.value.set(e.flashColor.r, e.flashColor.g, e.flashColor.b, e.flash);
    if (e.fade !== e.fadeTarget) {
      const step = dt * e.fadeSpeed;
      e.fade = e.fade < e.fadeTarget ? Math.min(e.fadeTarget, e.fade + step) : Math.max(e.fadeTarget, e.fade - step);
    }
    u.uFade.value = e.fade;
    e.glitch = Math.max(0, e.glitch - dt * 1.5);
    u.uGlitch.value = e.glitch;
    u.uDamage.value = e.damage;
    u.uThermal.value = e.thermal;
    this.gl.setRenderTarget(this.target);
    this.gl.render(this.scene, this.camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }

  capture(width = 480, height = 270) {
    // Re-render a frame and copy it into a small JPEG for game thumbnails.
    this.render(0, performance.now() / 1000);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    const src = this.canvas;
    const scale = Math.max(width / src.width, height / src.height);
    const sw = width / scale, sh = height / scale;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
    return c.toDataURL('image/jpeg', 0.82);
  }
}
