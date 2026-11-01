// One running game: the sandboxed engine iframe, the room WebSocket and voice chat, glued together.
import { Voice } from './voice.js';
import { auth } from '../api.js';
import { withData } from '../assets.js';

export class Session {
  // opts: { container, gameId, code, isPrivate, draft, solo: {game}, name, mic: bool, onLog, onLeave, onError, onWelcome, onThumb }
  constructor(opts) {
    this.o = opts;
    this.voice = null;
    this.ws = null;
    this.alive = true;
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    this.iframe.setAttribute('allow', 'autoplay; fullscreen');
    this.iframe.src = '/runtime/runtime.html';
    this.onMsg = (e) => { if (e.source === this.iframe.contentWindow) this.fromGame(e.data); };
    addEventListener('message', this.onMsg);
    opts.container.appendChild(this.iframe);
    this.timer = setInterval(() => this.tick(), 50);
    this.tickN = 0;
  }

  // Anything that arrives before the game is initialised (while assets load) waits in a queue.
  toGame(m) {
    if (m.t === 'init') {
      this.iframe.contentWindow?.postMessage(m, '*');
      this.initSent = true;
      for (const q of this.queue || []) this.iframe.contentWindow?.postMessage(q, '*');
      this.queue = null;
    } else if (!this.initSent) {
      if (m.t !== 'mic' && m.t !== 'speaking') (this.queue ||= []).push(m);
    } else this.iframe.contentWindow?.postMessage(m, '*');
  }

  async fromGame(m) {
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'ready': return this.start();
      case 'state': return this.send({ t: 's', s: m.s });
      case 'net': return this.send({ t: 'n', to: m.to, name: String(m.name), data: m.data });
      case 'chat': return this.send({ t: 'chat', text: String(m.text).slice(0, 200) });
      case 'net-lock': return this.send({ t: 'lock', locked: !!m.locked });
      case 'voiceMix': return this.voice?.setMix(m);
      case 'myVoice': return this.voice?.setEffect(['none', 'demon', 'ghost', 'robot'].includes(m.effect) ? m.effect : 'none');
      case 'mute': return this.toggleMute();
      case 'log': return this.o.onLog?.(m);
      case 'thumbnail': return this.o.onThumb?.(m.data);
      case 'leave': return this.o.onLeave?.();
      case 'recording': this.recording = !!m.on; return this.o.onRecording?.(this.recording);
      case 'movie': {
        // a finished recording from movie.record() / the Rec button
        if (!(m.blob instanceof Blob)) return;
        const url = URL.createObjectURL(m.blob);
        const name = String(m.name || 'shiver-movie').replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'shiver-movie';
        if (this.o.onMovie) return this.o.onMovie(url, name + '.webm', m.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name + '.webm';
        a.click();
        return;
      }
    }
  }

  send(m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  async start() {
    if (this.started) return;
    this.started = true;
    const settings = { sensitivity: Number(localStorage.getItem('shiver.sens')) || 0.0022 };
    if (this.o.solo) {
      // editor test: no server, we are the host
      this.myId = 'p1';
      if (this.o.mic) await this.setupVoice();
      const game = { ...this.o.solo.game, assets: await withData(this.o.solo.game.assets) };
      this.toGame({ t: 'init', mode: 'solo', you: 'p1', host: 'p1', seed: Math.floor(Math.random() * 2 ** 31), code: null, players: [{ pid: 'p1', name: this.o.name || 'You' }], game, settings });
      return;
    }
    const ws = (this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`));
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', gameId: this.o.gameId, code: this.o.code, private: this.o.isPrivate, draft: this.o.draft, token: auth.token, name: this.o.name }));
    ws.onclose = () => { if (this.alive) this.o.onError?.('Disconnected from the server.'); };
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      switch (m.t) {
        case 'welcome':
          this.myId = m.you;
          this.code = m.code;
          await this.setupVoice();
          for (const p of m.players) if (p.pid !== m.you) this.voice.addPeer(p.pid);
          this.o.onWelcome?.(m);
          m.game.assets = await withData(m.game.assets); // Pixeter art and images, fetched by hash
          this.toGame({ t: 'init', mode: 'online', you: m.you, name: m.name, host: m.host, seed: m.seed, code: m.code, players: m.players, game: m.game, settings });
          break;
        case 'error': this.o.onError?.(m.error); break;
        case 's': this.toGame({ t: 'state', from: m.from, s: m.s }); break;
        case 'n': this.toGame({ t: 'net', from: m.from, name: m.name, data: m.data }); break;
        case 'join': this.voice?.addPeer(m.pid); this.toGame(m); break;
        case 'leave': this.voice?.removePeer(m.pid); this.toGame(m); break;
        case 'host': this.toGame(m); break;
        case 'chat': this.toGame(m); break;
        case 'rtc': this.voice?.onSignal(m.from, m.data); break;
      }
    };
  }

  async setupVoice() {
    this.voice = new Voice({ myId: this.myId, signal: (to, data) => this.send({ t: 'rtc', to, data }) });
    if (this.o.mic) {
      try { await this.voice.enableMic(); } catch (err) { this.o.onLog?.({ level: 'warn', text: 'Microphone unavailable: ' + err.message }); }
    }
  }

  toggleMute() {
    if (!this.voice) return false;
    const m = this.voice.toggleMute();
    this.o.onMute?.(m);
    return m;
  }

  tick() {
    if (!this.voice) return;
    this.toGame({ t: 'mic', level: this.voice.readLevel(), muted: this.voice.muted, enabled: this.voice.micOn });
    if (++this.tickN % 3 === 0 && this.voice.peers.size) this.toGame({ t: 'speaking', levels: this.voice.speakingLevels() });
  }

  capture() { this.toGame({ t: 'capture' }); }
  record(on = !this.recording) { this.toGame({ t: 'record', on }); }

  destroy() {
    this.alive = false;
    clearInterval(this.timer);
    removeEventListener('message', this.onMsg);
    this.ws?.close();
    this.voice?.destroy();
    this.iframe.remove();
  }
}
