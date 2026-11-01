// The in-game HUD: objective, prompts, meters, inventory, chat, overlays and creator UI.
const h = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export class UI {
  constructor(engine) {
    this.engine = engine;
    const root = h('div', 'hud', document.getElementById('root'));
    this.root = root;
    this.labels = h('div', 'labels', root);
    this.custom = h('div', 'custom', root);
    this.cross = h('div', 'cross', root);
    this.promptEl = h('div', 'prompt', root);
    this.holdEl = h('div', 'hold', root);
    this.holdEl.innerHTML = '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg"/></svg>';
    this.objEl = h('div', 'objective', root);
    this.toasts = h('div', 'toasts', root);
    this.subEl = h('div', 'subtitle', root);
    this.bars = h('div', 'bars', root);
    this.stam = this.bar(this.bars, 'STAMINA', '#d8d2c0');
    this.batt = this.bar(this.bars, 'BATTERY', '#e8c860');
    this.mic = h('div', 'mic', root);
    this.mic.innerHTML = '<div class="mic-icon">MIC</div><div class="mic-meter"><i></i></div><div class="mic-warn">THEY CAN HEAR YOU</div>';
    this.micFill = this.mic.querySelector('i');
    this.inv = h('div', 'inventory', root);
    this.chatBox = h('div', 'chat', root);
    this.chatLog = h('div', 'chat-log', this.chatBox);
    this.chatInput = h('input', 'chat-input', this.chatBox);
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = 'Say something… (Enter)';
    this.list = h('div', 'playerlist hidden', root);
    this.overlay = h('div', 'overlay hidden', root);
    this.noteEl = h('div', 'note hidden', root);
    this.locker = h('div', 'locker hidden', root);
    this.stamp = h('div', 'stamp hidden', root);
    this.ghostTip = h('div', 'ghost-tip hidden', root, 'You are a ghost. Fly with WASD + Space/C. Press E near a light to flicker it. Living players hear you as a whisper.');
    this.timers = new Map();
    this.bars2 = new Map();
    this.texts = new Map();
    this.labelEls = new Map();
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) engine.sendChat(t);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  bar(parent, label, color) {
    const wrap = h('div', 'bar', parent);
    h('span', '', wrap, label);
    const track = h('div', 'track', wrap);
    const fill = h('i', '', track);
    fill.style.background = color;
    return { wrap, fill, set: (v) => (fill.style.width = Math.max(0, Math.min(1, v)) * 100 + '%') };
  }

  // ------------------------------------------------ creator-facing helpers
  objective(text) {
    this.objEl.textContent = text || '';
    this.objEl.classList.toggle('show', !!text);
    if (text) { this.objEl.classList.remove('pulse'); void this.objEl.offsetWidth; this.objEl.classList.add('pulse'); }
  }
  toast(text, secs = 3, color) {
    const t = h('div', 'toast', this.toasts, text);
    if (color) t.style.color = color;
    setTimeout(() => t.classList.add('out'), secs * 1000);
    setTimeout(() => t.remove(), secs * 1000 + 600);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }
  subtitle(text, secs = 4, speaker) {
    this.subEl.innerHTML = '';
    if (speaker) h('b', '', this.subEl, speaker + ': ');
    this.subEl.appendChild(document.createTextNode(text));
    this.subEl.classList.add('show');
    clearTimeout(this.subT);
    this.subT = setTimeout(() => this.subEl.classList.remove('show'), secs * 1000);
  }
  note(title, text) {
    this.noteEl.innerHTML = '';
    h('h2', '', this.noteEl, title || '');
    h('p', '', this.noteEl, text || '');
    h('small', '', this.noteEl, '[E] or [Esc] to close');
    this.noteEl.classList.remove('hidden');
    this.noteOpen = true;
  }
  closeNote() { this.noteEl.classList.add('hidden'); this.noteOpen = false; }
  text(id, text, o = {}) {
    let el = this.texts.get(id);
    if (!el) { el = h('div', 'ctext', this.custom); this.texts.set(id, el); }
    el.textContent = text;
    el.style.left = (o.x ?? 50) + '%';
    el.style.top = (o.y ?? 20) + '%';
    el.style.fontSize = (o.size ?? 22) + 'px';
    el.style.color = o.color ?? '#e8e2d0';
    el.style.transform = `translate(${o.align === 'left' ? '0' : o.align === 'right' ? '-100%' : '-50%'}, -50%)`;
    el.style.fontFamily = o.font ?? '';
    return el;
  }
  remove(id) { this.texts.get(id)?.remove(); this.texts.delete(id); this.bars2.get(id)?.wrap.remove(); this.bars2.delete(id); }
  progress(id, value, o = {}) {
    let b = this.bars2.get(id);
    if (!b) { b = this.bar(this.custom, o.label ?? id, o.color ?? '#c03030'); b.wrap.classList.add('cbar'); this.bars2.set(id, b); }
    b.wrap.style.left = (o.x ?? 50) + '%';
    b.wrap.style.top = (o.y ?? 8) + '%';
    b.set(value);
  }
  element(tag = 'div') { const e = h(tag, 'cel', this.custom); return e; }
  // An imported image / Pixeter sprite on the HUD (first frame). size = height in px.
  image(id, a, o = {}) {
    if (!a) return null;
    let el = this.texts.get(id);
    if (!el) { el = h('div', 'cimg', this.custom); this.texts.set(id, el); }
    const hpx = o.size ?? 200, wpx = (hpx * a.w) / a.h, f = o.frame ?? 0;
    Object.assign(el.style, {
      left: (o.x ?? 50) + '%', top: (o.y ?? 50) + '%', width: wpx + 'px', height: hpx + 'px', opacity: o.opacity ?? 1,
      backgroundImage: `url(${a.data})`, backgroundSize: `${a.cols * 100}% ${a.rows * 100}%`,
      backgroundPosition: `${a.cols > 1 ? ((f % a.cols) / (a.cols - 1)) * 100 : 0}% ${a.rows > 1 ? (Math.floor(f / a.cols) / (a.rows - 1)) * 100 : 0}%`,
    });
    return el;
  }
  clearCustom() { this.custom.innerHTML = ''; this.texts.clear(); this.bars2.clear(); this.objective(''); }

  // ------------------------------------------------ engine-driven bits
  prompt(text, holdFrac) {
    this.promptEl.textContent = text || '';
    this.promptEl.classList.toggle('show', !!text);
    this.holdEl.classList.toggle('show', holdFrac > 0);
    if (holdFrac > 0) this.holdEl.querySelector('.fg').style.strokeDashoffset = 94.2 * (1 - holdFrac);
  }
  inventory(items) {
    const key = items.join('|');
    if (key === this.invKey) return;
    this.invKey = key;
    this.inv.innerHTML = '';
    const counts = {};
    items.forEach((i) => (counts[i] = (counts[i] || 0) + 1));
    for (const [name, n] of Object.entries(counts)) h('div', 'slot', this.inv, n > 1 ? `${name} ×${n}` : name);
  }
  micLevel(level, muted, enabled) {
    this.mic.classList.toggle('off', !enabled || muted);
    this.mic.querySelector('.mic-icon').textContent = !enabled ? 'NO MIC' : muted ? 'MUTED' : 'MIC';
    this.micFill.style.width = Math.min(100, level * 100) + '%';
    this.mic.classList.toggle('loud', enabled && !muted && level > 0.45);
  }
  chat(name, text, color) {
    const line = h('div', 'line', this.chatLog);
    const b = h('b', '', line, name + ': ');
    if (color) b.style.color = color;
    line.appendChild(document.createTextNode(text));
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    this.chatBox.classList.add('active');
    clearTimeout(this.chatT);
    this.chatT = setTimeout(() => this.chatBox.classList.remove('active'), 8000);
  }
  openChat() {
    this.chatOpen = true;
    this.chatBox.classList.add('active', 'typing');
    this.chatInput.value = '';
    setTimeout(() => this.chatInput.focus(), 0);
  }
  closeChat() {
    this.chatOpen = false;
    this.chatBox.classList.remove('typing');
    this.chatInput.blur();
    this.engine.player.lockPointer();
  }
  playerList(show, players) {
    this.list.classList.toggle('hidden', !show);
    if (!show) return;
    this.list.innerHTML = '<h3>Players</h3>';
    for (const p of players) {
      const row = h('div', 'row', this.list);
      h('span', 'name', row, p.name + (p.isMe ? ' (you)' : '') + (p.isHost ? ' ★' : ''));
      h('span', 'role', row, !p.alive ? 'ghost' : p.role || '');
      h('span', 'spk' + (p.speaking > 0.1 ? ' on' : ''), row, '◉');
    }
  }
  // Floating name tags over other players (screen-space).
  label(id, text, x, y, visible, speaking) {
    let el = this.labelEls.get(id);
    if (!el) { el = h('div', 'tag', this.labels); this.labelEls.set(id, el); }
    if (!visible) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.textContent = text;
    el.classList.toggle('speaking', speaking > 0.08);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
  dropLabel(id) { this.labelEls.get(id)?.remove(); this.labelEls.delete(id); }

  showOverlay(html, cls = '') {
    this.overlay.className = 'overlay ' + cls;
    this.overlay.innerHTML = html;
  }
  hideOverlay() { this.overlay.className = 'overlay hidden'; }
  setLocker(on) { this.locker.classList.toggle('hidden', !on); }
  setStamp(on) { this.stamp.classList.toggle('hidden', !on); }
  tickStamp(t) {
    if (this.stamp.classList.contains('hidden')) return;
    const s = Math.floor(t), mm = String(Math.floor(s / 60) % 60).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    this.stamp.textContent = `▶ PLAY   00:${mm}:${ss}`;
  }
  setGhost(on) { this.ghostTip.classList.toggle('hidden', !on); this.root.classList.toggle('ghost', on); }
  hideHud(v) { this.root.classList.toggle('nohud', !!v); }
}
