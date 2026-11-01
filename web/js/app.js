// Shiver platform: tiny router, header, modals and login.
import { api, auth, esc, el } from './api.js';
import { homePage, searchPage } from './pages/home.js';
import { gamePage } from './pages/game.js';
import { playPage } from './pages/play.js';
import { studioPage } from './pages/studio.js';
import { editorPage } from './pages/editor.js';
import { docsPage } from './pages/docs.js';

const app = document.getElementById('app');
let cleanup = null;

const routes = [
  [/^\/$/, homePage],
  [/^\/search$/, searchPage],
  [/^\/game\/([\w-]+)$/, gamePage],
  [/^\/play\/([\w-]+)$/, playPage],
  [/^\/studio$/, studioPage],
  [/^\/studio\/([\w-]+)$/, editorPage],
  [/^\/docs$/, docsPage],
];

export function go(path, replace) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  render();
}

async function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  document.body.className = '';
  const path = location.pathname;
  for (const a of document.querySelectorAll('header nav a')) a.classList.toggle('active', a.getAttribute('href') === path || (path.startsWith('/studio') && a.getAttribute('href') === '/studio'));
  for (const [re, page] of routes) {
    const m = path.match(re);
    if (!m) continue;
    app.innerHTML = '';
    scrollTo(0, 0);
    try {
      cleanup = (await page(app, ...m.slice(1), new URLSearchParams(location.search))) || null;
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="wrap"><div class="empty">${esc(err.message || 'Something went wrong')}</div></div>`;
    }
    return;
  }
  app.innerHTML = '<div class="wrap"><div class="empty">Nothing here. Just the dark.</div></div>';
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
addEventListener('popstate', render);

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  go(q ? '/search?q=' + encodeURIComponent(q) : '/');
});

// ---------------------------------------------------------------- modals
export function modal(html, { wide } = {}) {
  const bg = el(`<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`);
  document.getElementById('modal-root').appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  const onKey = (e) => { if (e.key === 'Escape') { close(); removeEventListener('keydown', onKey); } };
  addEventListener('keydown', onKey);
  return { root: bg.firstElementChild, close };
}

export function loginModal(reason) {
  return new Promise((resolve) => {
    let mode = 'login';
    const m = modal(`
      <h2>${reason ? esc(reason) : 'Welcome back'}</h2>
      <div class="tabs"><button data-t="login" class="on">Log in</button><button data-t="signup">Create account</button></div>
      <form>
        <label>Username</label><input name="name" autocomplete="username" required maxlength="20">
        <label>Password</label><input name="password" type="password" autocomplete="current-password" required minlength="6">
        <div class="err"></div>
        <div class="acts"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn red" type="submit">Log in</button></div>
      </form>`);
    const f = m.root.querySelector('form');
    m.root.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.t;
      m.root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      f.querySelector('[type=submit]').textContent = mode === 'login' ? 'Log in' : 'Create account';
      f.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    }));
    m.root.querySelector('[data-cancel]').onclick = () => { m.close(); resolve(false); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/' + mode, { body: { name: f.name.value, password: f.password.value } });
        auth.set(r.token, r.user);
        m.close();
        resolve(true);
      } catch (err) {
        f.querySelector('.err').textContent = err.message;
      }
    });
    setTimeout(() => f.name.focus(), 0);
  });
}

export async function requireLogin(reason) {
  if (auth.user) return true;
  return loginModal(reason);
}

function renderUser() {
  const u = document.getElementById('user');
  if (auth.user) {
    u.innerHTML = `<a class="btn red" href="/studio" data-link>+ Create</a><span class="dim">${esc(auth.user.name)}</span><button class="btn ghost small" id="logout">Log out</button>`;
    u.querySelector('#logout').onclick = () => { auth.set('', null); go('/'); };
  } else {
    u.innerHTML = '<button class="btn ghost" id="login">Log in</button><button class="btn red" id="signup">Sign up</button>';
    u.querySelector('#login').onclick = () => loginModal();
    u.querySelector('#signup').onclick = () => { loginModal('Join Shiver'); setTimeout(() => document.querySelector('.modal .tabs [data-t=signup]')?.click(), 0); };
  }
}
addEventListener('auth', renderUser);

(async () => {
  if (auth.token) {
    try { auth.user = (await api('/me')).user; } catch {}
    if (!auth.user) auth.set('', null);
  }
  renderUser();
  render();
})();
