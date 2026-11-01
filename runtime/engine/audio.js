// Every sound in Shiver is synthesized live with WebAudio, so games ship with zero audio files.
// play(name, {pos}) is a one-shot (3D if pos given); loop(name) is ambience; music(name) is a score.
const ONE_SHOTS = ['step', 'thud', 'door', 'slam', 'locked', 'pickup', 'click', 'screech', 'jumpscare', 'whisper', 'heartbeat', 'stinger', 'static', 'bell', 'glitch', 'drip', 'knock', 'scream', 'beep', 'giggle', 'radio', 'hit', 'success', 'fail', 'swoosh', 'thunder', 'creak'];
const LOOPS = ['drone', 'wind', 'hum', 'generator', 'rain', 'static', 'heartbeat', 'whispers', 'clock'];
const MUSIC = ['chase', 'tension', 'calm'];

export class Audio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 6;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.comp).connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Small convolution reverb so everything sounds like it's in a big empty building.
    this.reverb = c.createConvolver();
    const len = c.sampleRate * 2.2;
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    this.wet = c.createGain();
    this.wet.gain.value = 0.25;
    this.reverb.connect(this.wet).connect(this.master);
    this.musicNode = null;
    this.loops = new Set();
    this.names = { oneShots: ONE_SHOTS, loops: LOOPS, music: MUSIC };
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  get now() { return this.ctx.currentTime; }
  setVolume(v) { this.master.gain.value = v; }

  setListener(pos, fwd, up) {
    const l = this.ctx.listener, t = this.now;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02); l.upY.setTargetAtTime(up.y, t, 0.02); l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // Output chain: [panner] -> gain -> master (+ reverb send)
  out(o = {}) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = o.volume ?? 1;
    g.connect(this.master);
    const send = c.createGain();
    send.gain.value = o.reverb ?? 0.6;
    g.connect(send).connect(this.reverb);
    if (!o.pos) return { input: g, gain: g };
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref ?? 1.5;
    p.maxDistance = o.range ?? 30;
    p.rolloffFactor = o.rolloff ?? 1.2;
    setPannerPos(p, o.pos, this.now);
    p.connect(g);
    return { input: p, gain: g, panner: p };
  }

  src(type = 'noise', freq = 440) {
    const c = this.ctx;
    if (type === 'noise') {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = freq === 440 ? 1 : freq;
      s.loopStart = Math.random();
      return s;
    }
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }
  filt(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  env(peak, a, d, t0 = this.now) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    return g;
  }
  shot(node, chain, dur, t0 = this.now) {
    let n = node;
    for (const c of chain) { n.connect(c); n = c; }
    node.start(t0);
    node.stop(t0 + dur + 0.05);
    return n;
  }

  play(name, o = {}) {
    if (!ONE_SHOTS.includes(name)) return null;
    this.resume();
    const out = this.out(o);
    const p = o.pitch ?? 1;
    const t = this.now;
    const s = this;
    const end = (n) => n.connect(out.input);
    switch (name) {
      case 'step': {
        const f = (o.soft ? 380 : 750) * (0.8 + Math.random() * 0.4) * p;
        end(s.shot(s.src('noise'), [s.filt('lowpass', f, 2), s.env(0.35, 0.005, 0.09)], 0.12));
        break;
      }
      case 'thud': {
        const o1 = s.src('sine', 70 * p);
        o1.frequency.exponentialRampToValueAtTime(28, t + 0.2);
        end(s.shot(o1, [s.env(0.9, 0.005, 0.25)], 0.3));
        end(s.shot(s.src('noise'), [s.filt('lowpass', 260), s.env(0.5, 0.005, 0.15)], 0.2));
        break;
      }
      case 'door': case 'creak': {
        const o1 = s.src('sawtooth', 150 * p);
        const lfo = s.src('sine', 13);
        const lg = s.ctx.createGain();
        lg.gain.value = 40;
        lfo.connect(lg).connect(o1.frequency);
        o1.frequency.linearRampToValueAtTime(110 * p, t + 0.9);
        lfo.start(t); lfo.stop(t + 1);
        end(s.shot(o1, [s.filt('bandpass', 1100, 6), s.env(0.5, 0.08, 0.85)], 1.0));
        break;
      }
      case 'slam': {
        end(s.shot(s.src('noise'), [s.filt('lowpass', 500), s.env(1.2, 0.003, 0.35)], 0.4));
        const o1 = s.src('sine', 90);
        o1.frequency.exponentialRampToValueAtTime(35, t + 0.3);
        end(s.shot(o1, [s.env(1.0, 0.003, 0.35)], 0.4));
        break;
      }
      case 'locked':
        for (const dt of [0, 0.09]) end(s.shot(s.src('square', 1300 * p), [s.filt('bandpass', 1800, 3), s.env(0.25, 0.002, 0.03, t + dt)], 0.05, t + dt));
        end(s.shot(s.src('noise'), [s.filt('bandpass', 2400, 2), s.env(0.3, 0.002, 0.12)], 0.15));
        break;
      case 'pickup': case 'success':
        [0, 0.07, 0.14].forEach((dt, i) => end(s.shot(s.src('triangle', [523, 659, 784][i] * p * (name === 'success' ? 1 : 1.25)), [s.env(0.3, 0.005, 0.25, t + dt)], 0.3, t + dt)));
        break;
      case 'fail':
        [0, 0.15].forEach((dt, i) => end(s.shot(s.src('square', [220, 155][i] * p), [s.filt('lowpass', 900), s.env(0.25, 0.005, 0.3, t + dt)], 0.35, t + dt)));
        break;
      case 'beep':
        end(s.shot(s.src('sine', 880 * p), [s.env(0.25, 0.005, 0.12)], 0.15));
        break;
      case 'click':
        end(s.shot(s.src('noise'), [s.filt('highpass', 2500), s.env(0.25, 0.001, 0.02)], 0.04));
        break;
      case 'hit':
        end(s.shot(s.src('noise'), [s.filt('lowpass', 1800), s.env(1, 0.002, 0.18)], 0.2));
        end(s.shot(s.src('sawtooth', 120), [s.filt('lowpass', 600), s.env(0.6, 0.002, 0.2)], 0.25));
        break;
      case 'swoosh': {
        const f = s.filt('bandpass', 400, 2);
        f.frequency.exponentialRampToValueAtTime(3000, t + 0.25);
        end(s.shot(s.src('noise'), [f, s.env(0.4, 0.08, 0.2)], 0.35));
        break;
      }
      case 'screech': {
        for (const det of [0, 7, -11]) {
          const o1 = s.src('sawtooth', (900 + det * 9) * p);
          o1.frequency.linearRampToValueAtTime((1500 + det * 20) * p, t + 0.3);
          o1.frequency.linearRampToValueAtTime((700 + det * 5) * p, t + 1.3);
          const vib = s.src('sine', 9 + det * 0.2), vg = s.ctx.createGain();
          vg.gain.value = 60;
          vib.connect(vg).connect(o1.frequency);
          vib.start(t); vib.stop(t + 1.4);
          end(s.shot(o1, [s.filt('bandpass', 2200, 1.5), s.env(0.35, 0.05, 1.2)], 1.4));
        }
        end(s.shot(s.src('noise'), [s.filt('highpass', 2000), s.env(0.4, 0.02, 0.9)], 1.0));
        break;
      }
      case 'jumpscare': {
        const shaper = s.ctx.createWaveShaper();
        shaper.curve = distCurve(40);
        for (const f of [196, 207, 277, 415, 587]) end(s.shot(s.src('sawtooth', f * p), [shaper, s.env(0.5, 0.005, 1.3)], 1.4));
        end(s.shot(s.src('noise'), [s.filt('bandpass', 1500, 0.6), s.env(1.4, 0.003, 1.0)], 1.1));
        const o1 = s.src('sine', 120);
        o1.frequency.exponentialRampToValueAtTime(30, t + 0.8);
        end(s.shot(o1, [s.env(1.2, 0.003, 0.9)], 1.0));
        break;
      }
      case 'whisper': {
        const dur = 1.2 + Math.random();
        const f = s.filt('bandpass', 2500 * p, 3);
        for (let i = 0; i < 6; i++) f.frequency.setValueAtTime((1800 + Math.random() * 2500) * p, t + (i * dur) / 6);
        const g = s.ctx.createGain();
        g.gain.value = 0;
        for (let i = 0; i < 14; i++) g.gain.setValueAtTime(Math.random() < 0.3 ? 0 : 0.5 + Math.random() * 0.4, t + (i * dur) / 14);
        g.gain.setValueAtTime(0, t + dur);
        end(s.shot(s.src('noise'), [f, g], dur));
        break;
      }
      case 'heartbeat':
        for (const [dt, v] of [[0, 1], [0.22, 0.7]]) {
          const o1 = s.src('sine', 58);
          o1.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
          end(s.shot(o1, [s.env(v, 0.01, 0.14, t + dt)], 0.2, t + dt));
        }
        break;
      case 'stinger': {
        const sw = s.filt('lowpass', 200, 1);
        sw.frequency.exponentialRampToValueAtTime(4000, t + 1.2);
        end(s.shot(s.src('noise'), [sw, s.env(0.5, 1.2, 0.05)], 1.3));
        const o1 = s.src('sine', 55);
        o1.frequency.exponentialRampToValueAtTime(30, t + 2.5);
        end(s.shot(o1, [s.env(1.2, 0.002, 2.4, t + 1.2)], 2.6, t + 1.2));
        for (const f of [110, 116.5, 164.8]) end(s.shot(s.src('sawtooth', f), [s.filt('lowpass', 700), s.env(0.25, 0.002, 2.2, t + 1.2)], 2.4, t + 1.2));
        break;
      }
      case 'static': case 'radio':
        end(s.shot(s.src('noise'), [s.filt('bandpass', name === 'radio' ? 1800 : 3000, 0.8), s.env(0.3, 0.005, name === 'radio' ? 0.15 : 0.5)], 0.6));
        break;
      case 'bell':
        for (const [m, v] of [[1, 0.4], [2.76, 0.2], [5.4, 0.1], [0.5, 0.25]]) end(s.shot(s.src('sine', 330 * m * p), [s.env(v, 0.002, 3.5)], 3.6));
        break;
      case 'glitch':
        for (let i = 0; i < 8; i++) end(s.shot(s.src('square', 100 + Math.random() * 2000), [s.env(0.15, 0.001, 0.03, t + i * 0.035)], 0.05, t + i * 0.035));
        break;
      case 'drip': {
        const o1 = s.src('sine', 1400 * p);
        o1.frequency.exponentialRampToValueAtTime(500, t + 0.06);
        end(s.shot(o1, [s.env(0.3, 0.001, 0.08)], 0.1));
        break;
      }
      case 'knock':
        for (const dt of [0, 0.28, 0.56]) {
          end(s.shot(s.src('noise'), [s.filt('lowpass', 700), s.env(0.9, 0.002, 0.08, t + dt)], 0.12, t + dt));
          end(s.shot(s.src('sine', 140), [s.env(0.6, 0.002, 0.1, t + dt)], 0.12, t + dt));
        }
        break;
      case 'scream': {
        const o1 = s.src('sawtooth', 700 * p);
        o1.frequency.linearRampToValueAtTime(1100 * p, t + 0.25);
        o1.frequency.linearRampToValueAtTime(600 * p, t + 1.3);
        const vib = s.src('sine', 7), vg = s.ctx.createGain();
        vg.gain.value = 35;
        vib.connect(vg).connect(o1.frequency);
        vib.start(t); vib.stop(t + 1.4);
        const f1 = s.filt('bandpass', 2700, 4), f2 = s.filt('peaking', 900, 2);
        f2.gain.value = 12;
        end(s.shot(o1, [f2, f1, s.env(0.8, 0.04, 1.2)], 1.4));
        break;
      }
      case 'giggle':
        for (let i = 0; i < 6; i++) {
          const dt = i * 0.11;
          const o1 = s.src('sine', (720 + Math.random() * 120) * p);
          o1.frequency.exponentialRampToValueAtTime(560 * p, t + dt + 0.09);
          end(s.shot(o1, [s.env(0.25 * (1 - i / 8), 0.01, 0.08, t + dt)], 0.1, t + dt));
        }
        break;
      case 'thunder': {
        const f = s.filt('lowpass', 900, 0.5);
        f.frequency.exponentialRampToValueAtTime(120, t + 3);
        end(s.shot(s.src('noise'), [f, s.env(1.4, 0.02, 3)], 3.1));
        break;
      }
    }
    return { stop: () => out.gain.disconnect() };
  }

  loop(name, o = {}) {
    if (!LOOPS.includes(name)) return { stop() {}, setPos() {}, setVolume() {} };
    this.resume();
    const out = this.out({ ...o, volume: 0 });
    const s = this, c = this.ctx, t = this.now;
    const nodes = [];
    const run = (n, chain) => { let x = n; for (const k of chain) { x.connect(k); x = k; } x.connect(out.input); n.start?.(); nodes.push(n); return n; };
    const lfo = (f, amt, param) => { const l = s.src('sine', f), g = c.createGain(); g.gain.value = amt; l.connect(g).connect(param); l.start(); nodes.push(l); };
    let timer = null;
    switch (name) {
      case 'drone':
        for (const f of [55, 55.6, 82.4, 110.3]) { const f1 = s.filt('lowpass', 280, 2); lfo(0.07 + Math.random() * 0.05, 120, f1.frequency); const g = c.createGain(); g.gain.value = 0.18; run(s.src(f > 100 ? 'triangle' : 'sawtooth', f), [f1, g]); }
        { const f1 = s.filt('bandpass', 400, 0.7); lfo(0.05, 250, f1.frequency); const g = c.createGain(); g.gain.value = 0.12; run(s.src('noise'), [f1, g]); }
        break;
      case 'wind': { const f1 = s.filt('bandpass', 500, 1.2); lfo(0.11, 300, f1.frequency); const g = c.createGain(); g.gain.value = 0.5; lfo(0.07, 0.25, g.gain); run(s.src('noise'), [f1, g]); break; }
      case 'rain': { const g = c.createGain(); g.gain.value = 0.3; run(s.src('noise'), [s.filt('highpass', 500), s.filt('lowpass', 4000), g]); break; }
      case 'hum': for (const f of [120, 240, 360]) { const g = c.createGain(); g.gain.value = 0.06 / (f / 120); run(s.src('sawtooth', f), [s.filt('bandpass', f, 8), g]); } break;
      case 'generator': { const g = c.createGain(); g.gain.value = 0.5; lfo(13, 0.25, g.gain); run(s.src('sawtooth', 46), [s.filt('lowpass', 260), g]); const g2 = c.createGain(); g2.gain.value = 0.25; run(s.src('noise'), [s.filt('lowpass', 300), g2]); break; }
      case 'static': { const g = c.createGain(); g.gain.value = 0.2; run(s.src('noise'), [s.filt('highpass', 1200), g]); break; }
      case 'whispers': timer = setInterval(() => this.play('whisper', { pos: o.pos, volume: 0.35 * (o.volume ?? 1), pitch: 0.8 + Math.random() * 0.4, range: o.range }), 900); break;
      case 'heartbeat': {
        const tick = () => { this.play('heartbeat', { volume: (o.volume ?? 1) * handle.rate }); timer = setTimeout(tick, 1000 / (0.9 + handle.rate * 1.8)); };
        timer = setTimeout(tick, 0);
        break;
      }
      case 'clock': timer = setInterval(() => this.play('click', { pos: o.pos, volume: 1.5, range: o.range }), 1000); break;
    }
    out.gain.gain.setTargetAtTime(o.volume ?? 1, t, 0.4);
    const loops = this.loops;
    const handle = {
      rate: o.rate ?? 0.3,
      stop() { loops.delete(handle); clearInterval(timer); clearTimeout(timer); out.gain.gain.setTargetAtTime(0, s.now, 0.25); setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch {} }); out.gain.disconnect(); }, 1200); },
      setPos(p) { if (out.panner) setPannerPos(out.panner, p, s.now); },
      setVolume(v) { out.gain.gain.setTargetAtTime(v, s.now, 0.2); },
    };
    loops.add(handle);
    return handle;
  }

  // Background score. music('chase') / music('tension') / music(null) to stop.
  music(name, volume = 0.5) {
    if (this.musicName === name) return;
    this.musicName = name;
    if (this.musicNode) this.musicNode.stop();
    this.musicNode = null;
    if (!MUSIC.includes(name)) return;
    this.resume();
    const s = this, c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(volume, this.now, 0.5);
    bus.connect(this.master);
    const bpm = name === 'chase' ? 150 : name === 'tension' ? 70 : 50;
    const step = 60 / bpm / 2;
    let next = this.now + 0.05, i = 0;
    const bass = name === 'chase' ? [55, 55, 58.3, 55, 51.9, 55, 61.7, 58.3] : [55, 55, 51.9, 51.9];
    const tick = () => {
      while (next < this.now + 0.2) {
        const t = next;
        if (name === 'chase') {
          if (i % 2 === 0) { const k = s.src('sine', 110); k.frequency.exponentialRampToValueAtTime(40, t + 0.12); s.shot(k, [s.env(0.9, 0.002, 0.18, t)], 0.2, t).connect(bus); }
          s.shot(s.src('noise'), [s.filt('highpass', 6000), s.env(i % 4 === 2 ? 0.25 : 0.08, 0.001, 0.05, t)], 0.07, t).connect(bus);
          s.shot(s.src('sawtooth', bass[i % 8]), [s.filt('lowpass', 500, 4), s.env(0.35, 0.005, step * 0.9, t)], step, t).connect(bus);
          if (i % 16 === 0) for (const f of [440, 466, 622]) s.shot(s.src('sawtooth', f), [s.filt('lowpass', 2000), s.env(0.06, 0.4, 1.4, t)], 1.9, t).connect(bus);
        } else if (name === 'tension') {
          if (i % 4 === 0) s.shot(s.src('sine', bass[(i / 4) % 4]), [s.env(0.5, 0.02, step * 3, t)], step * 4, t).connect(bus);
          if (i % 8 === 4) s.shot(s.src('triangle', 880 + (i % 3) * 37), [s.env(0.05, 0.3, 1.2, t)], 1.6, t).connect(bus);
        } else if (i % 8 === 0) {
          for (const f of [220, 261.6, 329.6]) s.shot(s.src('triangle', f * (i % 16 ? 0.89 : 1)), [s.env(0.05, 1.0, 2.5, t)], 3.6, t).connect(bus);
        }
        next += step;
        i++;
      }
    };
    const timer = setInterval(tick, 50);
    tick();
    this.musicNode = { stop: () => { clearInterval(timer); bus.gain.setTargetAtTime(0, s.now, 0.4); setTimeout(() => bus.disconnect(), 2000); } };
  }

  stopAll() {
    this.music(null);
    for (const l of [...this.loops]) l.stop();
  }
}

function setPannerPos(p, v, t) {
  if (p.positionX) {
    p.positionX.setTargetAtTime(v.x, t, 0.03); p.positionY.setTargetAtTime(v.y, t, 0.03); p.positionZ.setTargetAtTime(v.z, t, 0.03);
  } else p.setPosition(v.x, v.y, v.z);
}

function distCurve(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
  return curve;
}
