// Voice chat: a WebRTC mesh between everyone in the room. The game (iframe) tells us where each
// voice comes from, how muffled it is and whether it's on the radio; we do the actual audio here,
// because the game sandbox has no microphone access.

export class Voice {
  constructor({ signal, myId }) {
    this.signal = signal; // (to, data) => send over the WebSocket
    this.myId = myId;
    this.peers = new Map();
    this.muted = false;
    this.micOn = false;
    this.level = 0;
    this.effect = 'none';
    this.ice = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    // outgoing: mic -> mute gain -> [effect] -> stream destination (sent to every peer)
    this.dest = this.ctx.createMediaStreamDestination();
    this.input = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.input.connect(this.dest);
    this.chain = [];
    fetch('/api/ice').then((r) => r.json()).then((c) => (this.ice = c)).catch(() => {});
  }

  async enableMic() {
    this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    this.mic = this.ctx.createMediaStreamSource(this.stream);
    this.mic.connect(this.analyser);
    this.mic.connect(this.input);
    this.micOn = true;
    try { await this.ctx.audioWorklet.addModule('/web/js/play/pitch-worklet.js'); this.worklet = true; } catch { this.worklet = false; }
    this.setEffect(this.effect);
    return true;
  }

  // Loudness 0..1 for the game's "noise" (no AGC, so whispering really is quieter than shouting).
  readLevel() {
    if (!this.micOn) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    const target = Math.max(0, Math.min(1, (rms - 0.008) * 7));
    this.level = target > this.level ? target : this.level * 0.9 + target * 0.1;
    return this.muted ? 0 : this.level;
  }

  toggleMute(v = !this.muted) {
    this.muted = v;
    this.input.gain.setTargetAtTime(v ? 0 : 1, this.ctx.currentTime, 0.02);
    return v;
  }

  // 'none' | 'demon' | 'ghost' | 'robot' — applied to our own voice before sending it
  setEffect(name) {
    this.effect = name;
    if (!this.micOn) return;
    const c = this.ctx;
    this.input.disconnect();
    for (const n of this.chain) try { n.disconnect(); } catch {}
    this.chain = [];
    const link = (...nodes) => { let prev = this.input; for (const n of nodes) { prev.connect(n); prev = n; this.chain.push(n); } prev.connect(this.dest); };
    const pitch = (ratio) => {
      if (!this.worklet) return c.createGain();
      const n = new AudioWorkletNode(c, 'pitch-shifter');
      n.parameters.get('ratio').value = ratio;
      return n;
    };
    if (name === 'demon') {
      const sh = c.createWaveShaper();
      sh.curve = curve(8);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      const boost = c.createBiquadFilter();
      boost.type = 'lowshelf';
      boost.frequency.value = 200;
      boost.gain.value = 9;
      const g = c.createGain();
      g.gain.value = 1.5;
      link(pitch(0.66), sh, boost, lp, g);
    } else if (name === 'ghost') {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 500;
      const delay = c.createDelay(1);
      delay.delayTime.value = 0.21;
      const fb = c.createGain();
      fb.gain.value = 0.45;
      const p = pitch(1.18);
      link(p, hp);
      hp.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(this.dest);
      this.chain.push(delay, fb);
    } else if (name === 'robot') {
      const osc = c.createOscillator();
      osc.frequency.value = 50;
      const ring = c.createGain();
      ring.gain.value = 0;
      osc.connect(ring.gain);
      osc.start();
      link(ring);
      this.chain.push(osc);
    } else {
      this.input.connect(this.dest);
    }
  }

  // ---------------------------------------------------------------- peers
  addPeer(pid) {
    if (pid === this.myId || this.peers.has(pid)) return;
    const polite = num(this.myId) > num(pid);
    const pc = new RTCPeerConnection(this.ice);
    const peer = { pid, pc, polite, makingOffer: false, nodes: null, level: 0 };
    this.peers.set(pid, peer);
    for (const t of this.dest.stream.getAudioTracks()) pc.addTrack(t, this.dest.stream);
    pc.onicecandidate = (e) => e.candidate && this.signal(pid, { ice: e.candidate });
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(pid, { sdp: pc.localDescription });
      } catch (e) { console.warn('voice offer failed', e); } finally { peer.makingOffer = false; }
    };
    pc.ontrack = (e) => this.attach(peer, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.();
    };
    return peer;
  }

  async onSignal(from, data) {
    const peer = this.peers.get(from) || this.addPeer(from);
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (data.sdp) {
        const collision = data.sdp.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        if (collision && !peer.polite) return;
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { sdp: pc.localDescription });
        }
      } else if (data.ice) {
        try { await pc.addIceCandidate(data.ice); } catch {}
      }
    } catch (e) {
      console.warn('voice signal error', e);
    }
  }

  attach(peer, stream) {
    if (peer.nodes) return;
    const c = this.ctx;
    // Chrome only feeds WebRTC audio into WebAudio if a media element is also playing it.
    const a = new Audio();
    a.muted = true;
    a.srcObject = stream;
    a.play().catch(() => {});
    const src = c.createMediaStreamSource(stream);
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    const radio = c.createBiquadFilter();
    radio.type = 'allpass';
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;
    const panner = c.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0; // we compute loudness ourselves (walls, ghosts, radio)
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(analyser);
    src.connect(radio).connect(lowpass).connect(panner).connect(gain).connect(this.master);
    peer.nodes = { a, src, analyser, radio, lowpass, panner, gain, buf: new Float32Array(512) };
  }

  removePeer(pid) {
    const p = this.peers.get(pid);
    if (!p) return;
    p.pc.close();
    if (p.nodes) { p.nodes.gain.disconnect(); p.nodes.a.srcObject = null; }
    this.peers.delete(pid);
  }

  // From the game: { listener: {pos, fwd}, peers: { pid: {pos, gain, lowpass, radio, spatial} } }
  setMix(mix) {
    const c = this.ctx, t = c.currentTime;
    const L = c.listener, [lx, ly, lz] = mix.listener.pos, [fx, fy, fz] = mix.listener.fwd;
    if (L.positionX) {
      L.positionX.value = lx; L.positionY.value = ly; L.positionZ.value = lz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(lx, ly, lz); L.setOrientation(fx, fy, fz, 0, 1, 0); }
    for (const [pid, m] of Object.entries(mix.peers || {})) {
      const n = this.peers.get(pid)?.nodes;
      if (!n) continue;
      const [x, y, z] = m.spatial === false ? [lx + fx, ly + fy, lz + fz] : m.pos;
      if (n.panner.positionX) { n.panner.positionX.setTargetAtTime(x, t, 0.05); n.panner.positionY.setTargetAtTime(y, t, 0.05); n.panner.positionZ.setTargetAtTime(z, t, 0.05); }
      else n.panner.setPosition(x, y, z);
      n.gain.gain.setTargetAtTime(Math.max(0, Math.min(2, m.gain ?? 1)), t, 0.08);
      n.lowpass.frequency.setTargetAtTime(Math.max(200, Math.min(20000, m.lowpass ?? 20000)), t, 0.08);
      if (m.radio && n.radio.type !== 'bandpass') { n.radio.type = 'bandpass'; n.radio.frequency.value = 1800; n.radio.Q.value = 1.4; }
      else if (!m.radio && n.radio.type !== 'allpass') n.radio.type = 'allpass';
    }
  }

  speakingLevels() {
    const out = {};
    for (const [pid, p] of this.peers) {
      if (!p.nodes) continue;
      p.nodes.analyser.getFloatTimeDomainData(p.nodes.buf);
      let s = 0;
      for (const v of p.nodes.buf) s += v * v;
      out[pid] = Math.min(1, Math.sqrt(s / p.nodes.buf.length) * 8);
    }
    return out;
  }

  destroy() {
    for (const pid of [...this.peers.keys()]) this.removePeer(pid);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx.close();
  }
}

const num = (pid) => Number(String(pid).replace(/\D/g, '')) || 0;

function curve(k) {
  const n = 512, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}
