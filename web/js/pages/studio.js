import { api, esc, el } from '../api.js';
import { go, modal, requireLogin } from '../app.js';
import { coverInto } from '../cover.js';

export async function studioPage(root) {
  if (!(await requireLogin('Log in to make games'))) return go('/', true);
  const [{ games }, { templates }] = await Promise.all([api('/my/games'), api('/templates')]);
  const page = el(`<div class="wrap">
    <div class="studio-head"><h1>Your games</h1><button class="btn red big" id="new">+ New game</button></div>
    <div id="list"></div>
  </div>`);
  const list = page.querySelector('#list');
  if (!games.length) list.appendChild(el('<div class="empty">No games yet. Start from a template, remix a game you like, or begin with a blank room.</div>'));
  for (const g of games) {
    const row = el(`<div class="mygame"><div class="t"></div>
      <div class="info"><b>${esc(g.title)}</b><span class="status ${g.published ? 'pub' : 'draft'}">${g.published ? 'Published v' + g.version : 'Draft'}</span>
      <div class="dim" style="font-size:13px;margin-top:4px">${esc(g.style)} · ${g.plays} plays · ${g.likes} likes · edited ${new Date(g.updated).toLocaleString()}</div></div>
      <div class="acts">${g.published ? `<a class="btn ghost" href="/game/${g.id}" data-link>View</a>` : ''}<a class="btn" href="/studio/${g.id}" data-link>Edit</a><button class="btn ghost" data-del>Delete</button></div></div>`);
    coverInto(row.querySelector('.t'), g);
    row.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Delete "${g.title}" forever?`)) return;
      await api('/my/games/' + g.id, { method: 'DELETE' });
      row.remove();
    };
    list.appendChild(row);
  }
  page.querySelector('#new').onclick = () => {
    let pick = 'blank';
    const m = modal(`<h2>New game</h2><label>Title</label><input id="t" placeholder="Untitled Horror" maxlength="60">
      <label>Start from</label><div class="tpls">${templates.map((t) => `<button class="tpl ${t.id === 'blank' ? 'sel' : ''}" data-id="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.description).slice(0, 140)}</span></button>`).join('')}</div>
      <div class="acts"><button class="btn ghost" data-x>Cancel</button><button class="btn red" data-go>Create</button></div>`, { wide: true });
    m.root.querySelectorAll('.tpl').forEach((b) => (b.onclick = () => { pick = b.dataset.id; m.root.querySelectorAll('.tpl').forEach((x) => x.classList.toggle('sel', x === b)); }));
    m.root.querySelector('[data-x]').onclick = m.close;
    m.root.querySelector('[data-go]').onclick = async () => {
      const r = await api('/my/games', { body: { template: pick, title: m.root.querySelector('#t').value } });
      m.close();
      go('/studio/' + r.game.id);
    };
  };
  root.appendChild(page);
}
