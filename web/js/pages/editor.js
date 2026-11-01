// Shiver Studio editor: scripts on the left, Monaco in the middle, a live game on the right.
import { api, auth, esc, el } from '../api.js';
import { go, modal, requireLogin } from '../app.js';
import { Session } from '../play/session.js';
import { importFiles, blobData } from '../assets.js';
import { openSpriteEditor as spriteEditor } from '../sprite-editor.js';

let monacoReady = null;
function loadMonaco() {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise((resolve, reject) => {
    window.MonacoEnvironment = {
      getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${location.origin}/vendor/monaco/'};importScripts('${location.origin}/vendor/monaco/vs/base/worker/workerMain.js');`)}`,
    };
    const s = document.createElement('script');
    s.src = '/vendor/monaco/vs/loader.js';
    s.onerror = reject;
    s.onload = () => {
      window.require.config({ paths: { vs: '/vendor/monaco/vs' } });
      window.require(['vs/editor/editor.main'], async () => {
        const monaco = window.monaco;
        const js = monaco.languages.typescript.javascriptDefaults;
        js.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ES2022, allowNonTsExtensions: true, checkJs: false, lib: ['es2022', 'dom'] });
        js.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false, diagnosticCodesToIgnore: [1108, 1308, 1375, 1378] });
        try { js.addExtraLib(await (await fetch('/runtime/shiver.d.ts')).text(), 'file:///shiver.d.ts'); } catch {}
        monaco.editor.defineTheme('shiver', {
          base: 'vs-dark', inherit: true,
          rules: [{ token: 'comment', foreground: '7d7466', fontStyle: 'italic' }, { token: 'keyword', foreground: 'ff6a6a' }, { token: 'string', foreground: 'd8c890' }, { token: 'number', foreground: 'f0a070' }],
          colors: { 'editor.background': '#0c0a0a', 'editor.lineHighlightBackground': '#1a1313', 'editorCursor.foreground': '#ff4040', 'editor.selectionBackground': '#4a1c1c', 'editorLineNumber.foreground': '#4a4040' },
        });
        resolve(monaco);
      });
    };
    document.head.appendChild(s);
  });
  return monacoReady;
}

const kindOf = (name) => name.match(/\.(host|client|shared)\.js$/)?.[1] || 'shared';
const ORDER = { shared: 0, host: 1, client: 2 };

export async function editorPage(root, id) {
  if (!(await requireLogin('Log in to edit games'))) return go('/', true);
  const [{ game }, monaco] = await Promise.all([api('/my/games/' + id), loadMonaco()]);
  document.body.classList.add('editing');
  document.title = `${game.title} — Shiver Studio`;

  const page = el(`<div class="editor">
    <div class="etop">
      <a class="btn ghost small" href="/studio" data-link>←</a>
      <input class="title" value="${esc(game.title)}" maxlength="60">
      <span class="saved">Saved</span>
      <button class="btn small" data-a="settings">⚙ Settings</button>
      <a class="btn small ghost" href="/docs" target="_blank">Docs</a>
      <button class="btn small" data-a="test" title="Ctrl/Cmd + Enter">▶ Test</button>
      <button class="btn small" data-a="friends">👥 Test with friends</button>
      <button class="btn small red" data-a="publish">${game.published ? 'Update game' : 'Publish'}</button>
    </div>
    <div class="ebody">
      <div class="files"><h4>SCRIPTS <button data-a="add" title="New script">+</button></h4><div class="flist"></div>
        <h4 style="margin-top:18px">ASSETS <span><button data-a="sprite" title="Draw a new sprite">✎</button><button data-a="import" title="Import .pixeter files or images">+</button></span></h4><div class="alist"></div>
        <input type="file" class="afile" multiple accept=".pixeter,.png,.jpg,.jpeg,.gif,.webp,.json" hidden>
        <div class="legend"><p>Draw in <a href="https://pixeter.app" target="_blank">Pixeter</a>, then drop the <b>.pixeter</b> file anywhere here. Click an asset to insert it as a sprite, or Alt-click to use it as a texture.</p><p><span class="k shared">shared</span> runs on every player. Build the level here.</p><p><span class="k host">host</span> runs on one player, the room's "server". Rules, monsters, scores.</p><p><span class="k client">client</span> runs on each player. HUD, sounds, effects.</p></div>
      </div>
      <div id="monaco"></div>
      <div class="split"></div>
      <div class="preview">
        <div class="ptop"><button class="btn small" data-a="test">▶ Test</button><button class="btn small ghost" data-a="stop">■ Stop</button>
          <label style="display:flex;gap:6px;align-items:center;margin-left:6px"><input type="checkbox" id="mic"> mic</label>
          <span style="flex:1"></span><button class="btn small ghost" data-a="rec" title="Record the game view (with cutscene subtitles and sound) to a video file">● Rec</button><button class="btn small ghost" data-a="sprite" title="Draw a sprite">🎨 Sprite editor</button><button class="btn small ghost" data-a="thumb" title="Use the current frame as the game's thumbnail">📷 Thumbnail</button><button class="btn small ghost" data-a="clear">Clear log</button></div>
        <div class="stage"><div class="idle"><div style="font-family:var(--type);font-size:22px;color:#c8c0a8">Press ▶ Test</div><div>Your game runs here, right next to the code.<br>Ctrl/Cmd + S saves · Ctrl/Cmd + Enter restarts the test.</div></div></div>
        <div class="console"></div>
      </div>
    </div>
  </div>`);
  root.appendChild(page);

  const state = { game, files: [...game.scripts], assets: [...(game.assets || [])], current: null, dirty: false, session: null, friendsBar: null };
  const models = new Map();
  for (const f of state.files) models.set(f.name, monaco.editor.createModel(f.code, 'javascript', monaco.Uri.parse('file:///' + f.name)));
  const editor = monaco.editor.create(page.querySelector('#monaco'), {
    theme: 'shiver', automaticLayout: true, fontSize: 13, fontFamily: 'JetBrains Mono, Menlo, monospace', minimap: { enabled: false },
    scrollBeyondLastLine: false, tabSize: 2, smoothScrolling: true, padding: { top: 10 }, fixedOverflowWidgets: true,
  });
  editor.onDidChangeModelContent(() => markDirty());

  const saved = page.querySelector('.saved');
  const flist = page.querySelector('.flist');
  const consoleEl = page.querySelector('.console');
  const stage = page.querySelector('.stage');

  function renderFiles() {
    flist.innerHTML = '';
    const names = [...models.keys()].sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)] || a.localeCompare(b));
    for (const name of names) {
      const k = kindOf(name);
      const row = el(`<div class="file ${name === state.current ? 'sel' : ''}"><span class="k ${k}">${k}</span><span>${esc(name.replace(/\.(host|client|shared)\.js$/, ''))}</span><span class="x" title="Delete">✕</span></div>`);
      row.onclick = (e) => {
        if (e.target.classList.contains('x')) {
          if (models.size <= 1 || !confirm(`Delete ${name}?`)) return;
          models.get(name).dispose();
          models.delete(name);
          if (state.current === name) open([...models.keys()][0]);
          renderFiles();
          markDirty();
          return;
        }
        open(name);
      };
      row.ondblclick = () => {
        const base = prompt('Rename script', name.replace(/\.(host|client|shared)\.js$/, ''));
        if (!base) return;
        const nn = base.replace(/[^\w-]/g, '').slice(0, 40) + '.' + k + '.js';
        if (models.has(nn)) return;
        const m = models.get(name);
        const code = m.getValue();
        m.dispose();
        models.delete(name);
        models.set(nn, monaco.editor.createModel(code, 'javascript', monaco.Uri.parse('file:///' + nn)));
        if (state.current === name) open(nn);
        renderFiles();
        markDirty();
      };
      flist.appendChild(row);
    }
  }
  function open(name, line) {
    state.current = name;
    editor.setModel(models.get(name));
    renderFiles();
    if (line) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      const m = models.get(name);
      const deco = m.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'errline', inlineClassName: '', linesDecorationsClassName: 'errgutter' } }]);
      setTimeout(() => m.deltaDecorations(deco, []), 4000);
    }
    editor.focus();
  }
  // ---------------------------------------------------------------- assets (Pixeter art, images)
  const alist = page.querySelector('.alist');
  function renderAssets() {
    alist.innerHTML = '';
    if (!state.assets.length) alist.appendChild(el('<div class="file" style="cursor:default;color:var(--dim)">No art yet</div>'));
    for (const a of state.assets) {
      const info = a.kind === 'sprite' ? `${a.frames.length} frames${a.tags.length ? ' · ' + a.tags.map((t) => t.name).join(', ') : ''}` : `${a.w}×${a.h}`;
      const row = el(`<div class="file asset" title="Click: insert as sprite · Alt-click: insert as texture · Double-click: edit"><span class="thumb"></span><span class="aname">${esc(a.name)}<small>${esc(info)}</small></span><span class="x" title="Remove">✕</span></div>`);
      const th = row.querySelector('.thumb');
      const paint = (data) => Object.assign(th.style, { backgroundImage: `url(${data})`, backgroundSize: `${a.cols * 100}% ${a.rows * 100}%` });
      if (a.data) paint(a.data); else blobData(a.hash).then(paint).catch(() => {});
      row.ondblclick = () => openSpriteEditor(a);
      row.onclick = (e) => {
        if (e.target.classList.contains('x')) {
          state.assets = state.assets.filter((x) => x !== a);
          renderAssets();
          markDirty();
          return;
        }
        const text = e.altKey
          ? `world.box({ pos: [0, 1.5, -3], size: [2, 3, 0.2], texture: 'asset:${a.name}' });\n`
          : `world.sprite('${a.name}', { pos: [0, 0, -3]${a.tags.length ? `, animation: '${a.tags[0].name}'` : ''} });\n`;
        editor.executeEdits('asset', [{ range: editor.getSelection(), text, forceMoveMarkers: true }]);
        editor.focus();
      };
      alist.appendChild(row);
    }
  }
  // Built-in sprite editor (new sprite, or double-click an asset to edit it)
  function openSpriteEditor(existing) {
    spriteEditor({
      asset: existing,
      onSave: (a) => {
        const i = state.assets.findIndex((x) => x.name === a.name || x === existing);
        if (i >= 0) state.assets[i] = a; else state.assets.push(a);
        renderAssets();
        markDirty();
        log('info', `Saved sprite "${a.name}"${a.frames.length > 1 ? ` (${a.frames.length} frames)` : ''}. Use it with world.sprite('${a.name}').`);
      },
    });
  }

  async function addFiles(files) {
    try {
      const imported = await importFiles(files);
      for (const a of imported) {
        const i = state.assets.findIndex((x) => x.name === a.name);
        if (i >= 0) state.assets[i] = a; else state.assets.push(a);
        log('info', `Imported ${a.name}${a.source === 'pixeter' ? ' from Pixeter' : ''}: ${a.kind === 'sprite' ? a.frames.length + ' frames' : a.w + '×' + a.h}${a.tags.length ? ', animations: ' + a.tags.map((t) => t.name).join(', ') : ''}.`);
      }
      renderAssets();
      markDirty();
    } catch (err) {
      log('error', err.message);
    }
  }
  const afile = page.querySelector('.afile');
  afile.onchange = () => { addFiles(afile.files); afile.value = ''; };
  page.addEventListener('dragover', (e) => { e.preventDefault(); page.classList.add('dropping'); });
  page.addEventListener('dragleave', (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove('dropping'); });
  page.addEventListener('drop', (e) => { e.preventDefault(); page.classList.remove('dropping'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  renderFiles();
  renderAssets();
  open([...models.keys()].sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)])[0]);

  // ---------------------------------------------------------------- saving
  let saveTimer = null;
  function markDirty() {
    state.dirty = true;
    saved.textContent = 'Unsaved changes';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 2000);
  }
  const scripts = () => [...models.entries()].map(([name, m]) => ({ name, code: m.getValue() }));
  async function save(extra = {}) {
    clearTimeout(saveTimer);
    try {
      saved.textContent = 'Saving…';
      // upload new art first (stored by content hash), then save the game
      for (const a of state.assets) if (!a.hash) a.hash = (await api('/blobs', { body: { data: a.data } })).hash;
      const assets = state.assets.map(({ data, ...meta }) => meta);
      const r = await api('/my/games/' + id, { method: 'PUT', body: { title: page.querySelector('.title').value, scripts: scripts(), assets, ...extra } });
      Object.assign(state.game, r.game);
      state.dirty = false;
      saved.textContent = 'Saved';
      return true;
    } catch (err) {
      saved.textContent = 'Save failed: ' + err.message;
      return false;
    }
  }
  page.querySelector('.title').addEventListener('input', markDirty);

  // ---------------------------------------------------------------- console
  function log(level, text, script, line) {
    const l = el(`<div class="l ${level}"></div>`);
    if (script && models.has(script)) {
      const a = el(`<a>${esc(script)}${line ? ':' + line : ''}</a>`);
      a.onclick = () => open(script, line);
      l.append(a, ' ');
    }
    l.append(text);
    consoleEl.appendChild(l);
    while (consoleEl.children.length > 300) consoleEl.firstChild.remove();
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  // ---------------------------------------------------------------- testing
  function stop() {
    state.session?.destroy();
    state.session = null;
    state.friendsBar?.remove();
    state.friendsBar = null;
    stage.querySelector('.idle')?.classList.remove('hidden');
  }
  function test() {
    stop();
    consoleEl.innerHTML = '';
    stage.querySelector('.idle').classList.add('hidden');
    state.session = new Session({
      container: stage,
      solo: { game: { id, title: page.querySelector('.title').value, style: state.game.style, scripts: scripts(), assets: state.assets, draft: true } },
      mic: page.querySelector('#mic').checked,
      name: auth.user.name,
      onLog: (m) => log(m.level, m.text, m.script, m.line),
      onThumb: async (data) => { await save({ thumbnail: data }); log('info', 'Thumbnail saved.'); },
      onRecording: (on) => { page.querySelector('[data-a=rec]').textContent = on ? '■ Stop rec' : '● Rec'; page.querySelector('[data-a=rec]').classList.toggle('red', on); if (on) log('info', '● Recording… press ■ Stop rec when done.'); },
      onMovie: (url, name) => {
        const l = el(`<div class="l info">🎬 Movie ready: <a href="${url}" download="${esc(name)}">${esc(name)}</a></div>`);
        consoleEl.appendChild(l);
        consoleEl.scrollTop = consoleEl.scrollHeight;
        l.querySelector('a').click();
      },
      onLeave: stop,
    });
    log('info', '▶ Test started. Click the game to play. Esc frees the mouse.');
  }
  async function friends() {
    if (!(await save())) return;
    stop();
    consoleEl.innerHTML = '';
    stage.querySelector('.idle').classList.add('hidden');
    state.session = new Session({
      container: stage, gameId: id, draft: true, isPrivate: true, mic: page.querySelector('#mic').checked, name: auth.user.name,
      onLog: (m) => log(m.level, m.text, m.script, m.line),
      onThumb: async (data) => { await save({ thumbnail: data }); log('info', 'Thumbnail saved.'); },
      onWelcome: (m) => {
        const link = `${location.origin}/play/${id}?code=${m.code}`;
        state.friendsBar = el(`<div class="friends">Private test room <code>${m.code}</code>. Friends join at <a href="${link}" target="_blank">${esc(link)}</a> <button class="btn small">Copy</button></div>`);
        state.friendsBar.querySelector('button').onclick = () => navigator.clipboard?.writeText(link);
        page.querySelector('.preview').insertBefore(state.friendsBar, stage);
      },
      onError: (e) => { log('error', e); stop(); },
      onLeave: stop,
    });
  }

  async function publish() {
    if (!(await save())) return;
    if (!state.game.description) {
      const ok = await settings(true);
      if (!ok) return;
    }
    const r = await api(`/my/games/${id}/publish`, { body: {} });
    Object.assign(state.game, r.game);
    page.querySelector('[data-a=publish]').textContent = 'Update game';
    const m = modal(`<h2>It's alive.</h2><p>Your game is published as version ${r.game.version}. Anyone can play it now.</p>
      <div class="acts"><button class="btn ghost" data-x>Keep editing</button><a class="btn red" href="/game/${id}" data-link>Open game page</a></div>`);
    m.root.querySelector('[data-x]').onclick = m.close;
    m.root.querySelector('a').addEventListener('click', m.close);
  }

  function settings(forPublish) {
    return new Promise((resolve) => {
      const g = state.game;
      let style = g.style;
      const m = modal(`<h2>${forPublish ? 'Before you publish' : 'Game settings'}</h2>
        <label>Description (what is it, how many players, what should they fear?)</label><textarea rows="4" id="desc" maxlength="2000">${esc(g.description)}</textarea>
        <label>Tags (comma separated)</label><input id="tags" value="${esc((g.tags || []).join(', '))}">
        <label>Max players per room</label><input id="max" type="number" min="1" max="16" value="${g.maxPlayers}">
        <label>Visual style</label><div class="styles">${['retro', 'vhs', 'hd', 'noir', 'pixel'].map((s) => `<button data-s="${s}" class="${s === style ? 'on' : ''}">${s}</button>`).join('')}</div>
        <p class="dim" style="font-size:12px">Retro is PS1-style low-res with dithering. VHS adds tape tracking and chromatic aberration. HD is full resolution with shadows. Noir is black and white film. Pixel is chunky top-down pixel art. Scripts can also change it live with render.style().</p>
        <div class="err"></div>
        <div class="acts"><button class="btn ghost" data-x>Cancel</button><button class="btn red" data-ok>${forPublish ? 'Publish' : 'Save'}</button></div>`);
      m.root.querySelectorAll('.styles button').forEach((b) => (b.onclick = () => { style = b.dataset.s; m.root.querySelectorAll('.styles button').forEach((x) => x.classList.toggle('on', x === b)); }));
      m.root.querySelector('[data-x]').onclick = () => { m.close(); resolve(false); };
      m.root.querySelector('[data-ok]').onclick = async () => {
        const desc = m.root.querySelector('#desc').value.trim();
        if (forPublish && desc.length < 10) { m.root.querySelector('.err').textContent = 'Write a short description so players know what they are in for.'; return; }
        const ok = await save({ description: desc, tags: m.root.querySelector('#tags').value.split(',').map((t) => t.trim()).filter(Boolean), maxPlayers: Number(m.root.querySelector('#max').value), style });
        if (ok) { m.close(); resolve(true); }
      };
    });
  }

  function addScript() {
    const m = modal(`<h2>New script</h2><label>Name</label><input id="n" placeholder="monster" maxlength="40">
      <label>Runs on</label><div class="styles" style="grid-template-columns:repeat(3,1fr)"><button data-k="shared" class="on">shared · everyone</button><button data-k="host">host · rules</button><button data-k="client">client · each player</button></div>
      <div class="acts"><button class="btn ghost" data-x>Cancel</button><button class="btn red" data-ok>Create</button></div>`);
    let k = 'shared';
    m.root.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { k = b.dataset.k; m.root.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); }));
    m.root.querySelector('[data-x]').onclick = m.close;
    m.root.querySelector('[data-ok]').onclick = () => {
      const base = m.root.querySelector('#n').value.replace(/[^\w-]/g, '').slice(0, 40) || 'script';
      const name = `${base}.${k}.js`;
      if (models.has(name)) return;
      const starter = { shared: '// Runs on every player.\n', host: '// Runs only on the host.\n\non(\'update\', (dt) => {\n  \n});\n', client: '// Runs on each player.\n' }[k];
      models.set(name, monaco.editor.createModel(starter, 'javascript', monaco.Uri.parse('file:///' + name)));
      m.close();
      open(name);
      markDirty();
    };
    setTimeout(() => m.root.querySelector('#n').focus(), 0);
  }

  page.querySelector('.etop').onclick = page.querySelector('.ptop').onclick = page.querySelector('.files').onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'test') test();
    else if (a === 'stop') stop();
    else if (a === 'friends') friends();
    else if (a === 'publish') publish();
    else if (a === 'settings') settings(false);
    else if (a === 'add') addScript();
    else if (a === 'import') afile.click();
    else if (a === 'clear') consoleEl.innerHTML = '';
    else if (a === 'rec') { if (state.session) state.session.record(); else log('warn', 'Start a test first, then record.'); }
    else if (a === 'sprite') openSpriteEditor();
    else if (a === 'thumb') { if (state.session) state.session.capture(); else log('warn', 'Start a test first, then frame a nice shot.'); }
  };

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); test(); }
  };
  addEventListener('keydown', onKey);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => test());

  // resizable preview
  const split = page.querySelector('.split');
  split.onmousedown = (e) => {
    e.preventDefault();
    const body = page.querySelector('.ebody');
    const move = (ev) => {
      const r = body.getBoundingClientRect();
      const pct = Math.max(20, Math.min(70, ((r.right - ev.clientX) / r.width) * 100));
      body.style.setProperty('--preview', pct + '%');
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };

  const beforeUnload = (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', beforeUnload);

  return () => {
    if (state.dirty) save();
    stop();
    removeEventListener('keydown', onKey);
    removeEventListener('beforeunload', beforeUnload);
    editor.dispose();
    for (const m of models.values()) m.dispose();
    document.body.classList.remove('editing');
  };
}
