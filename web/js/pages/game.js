import { api, auth, esc, el } from '../api.js';
import { go, requireLogin } from '../app.js';
import { coverInto } from '../cover.js';

export async function gamePage(root, id) {
  const { game: g } = await api('/games/' + id);
  document.title = `${g.title} — Shiver`;
  const page = el(`<div class="wrap"><div class="gamepage">
    <div>
      <div class="cover"></div>
      <h1 style="margin-top:22px">${esc(g.title)}</h1>
      <div class="by">by ${esc(g.creator)}${g.official ? ' ✓' : ''} · up to ${g.maxPlayers} players</div>
      <div>${[`<span class="chip style">${esc(g.style)}</span>`, ...(g.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`)].join('')}</div>
      <p class="desc">${esc(g.description || 'No description.')}</p>
    </div>
    <div>
      <div class="playbox">
        <a class="btn red big" href="/play/${g.id}" data-link>▶ Play</a>
        <button class="btn" id="private">Start a private room</button>
        <div class="rowx"><input id="code" placeholder="ROOM CODE" maxlength="6"><button class="btn" id="join">Join</button></div>
        <div class="rowx"><button class="btn ghost" id="like" style="flex:1">${g.liked ? '♥ Liked' : '♡ Like'}</button><button class="btn ghost" id="remix" style="flex:1">⑂ Remix</button></div>
      </div>
      <div class="stats"><div><b>${g.plays}</b><span>plays</span></div><div><b id="likes">${g.likes}</b><span>likes</span></div><div><b class="${g.playing ? 'live' : ''}">${g.playing}</b><span>playing now</span></div></div>
      <div class="servers"><h3 style="font-family:var(--type);font-weight:normal">Live rooms</h3>${g.rooms.length ? '' : '<div class="dim" style="font-size:13px">No public rooms right now. Press Play to open one.</div>'}</div>
      <p class="dim" style="font-size:13px;line-height:1.6">Use headphones. Your microphone volume makes noise in the game, and monsters can hear it.</p>
    </div>
  </div></div>`);
  coverInto(page.querySelector('.cover'), g);
  const servers = page.querySelector('.servers');
  for (const r of g.rooms) {
    const s = el(`<div class="srv"><b>${r.players}/${r.max}</b><span class="names">${esc(r.names.join(', '))}</span>${r.locked ? '<span class="dim">in progress</span>' : `<a class="btn small" href="/play/${g.id}?code=${r.code}" data-link>Join</a>`}</div>`);
    servers.appendChild(s);
  }
  page.querySelector('#private').onclick = () => go(`/play/${g.id}?private=1`);
  page.querySelector('#join').onclick = () => {
    const code = page.querySelector('#code').value.trim().toUpperCase();
    if (code) go(`/play/${g.id}?code=${code}`);
  };
  page.querySelector('#like').onclick = async () => {
    if (!(await requireLogin('Log in to like games'))) return;
    const r = await api(`/games/${g.id}/like`, { body: {} });
    page.querySelector('#like').textContent = r.liked ? '♥ Liked' : '♡ Like';
    page.querySelector('#likes').textContent = r.likes;
  };
  page.querySelector('#remix').onclick = async () => {
    if (!(await requireLogin('Log in to remix this game'))) return;
    const r = await api('/my/games', { body: { from: g.id } });
    go('/studio/' + r.game.id);
  };
  root.appendChild(page);
}
