import { api, esc, el } from '../api.js';
import { coverInto, coverURL } from '../cover.js';

export function card(g) {
  const c = el(`<a class="card" href="/game/${g.id}" data-link>
    <div class="thumb"><span class="badge chip style">${esc(g.style)}</span>${g.playing ? `<span class="players live">${g.playing} playing</span>` : ''}</div>
    <div class="meta"><div class="title">${esc(g.title)}</div>
    <div class="sub"><span>by ${esc(g.creator)}${g.official ? ' ✓' : ''}</span><span>▶ ${fmt(g.plays)} · ♥ ${fmt(g.likes)}</span></div></div></a>`);
  coverInto(c.querySelector('.thumb'), g);
  return c;
}

const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

function row(title, sub, games) {
  const s = el(`<section class="row"><h2>${esc(title)} <small>${esc(sub || '')}</small></h2><div class="grid"></div></section>`);
  const grid = s.querySelector('.grid');
  if (!games.length) grid.replaceWith(el('<div class="empty">No games here yet. Be the first to make one.</div>'));
  for (const g of games) grid.appendChild(card(g));
  return s;
}

export async function homePage(root) {
  const [popular, fresh, stats] = await Promise.all([api('/games?sort=popular'), api('/games?sort=new'), api('/stats')]);
  const top = popular.games[0];
  const hero = el(`<div class="hero"><div class="bg"></div><div class="inner">
    <div class="kicker">${stats.online ? `<span class="live">${stats.online} people screaming right now</span>` : 'Multiplayer horror, made by players'}</div>
    <h1>${top ? esc(top.title) : 'Make something terrifying.'}</h1>
    <p>${top ? esc(top.description) : ''}</p>
    <div class="actions">${top ? `<a class="btn red big" href="/play/${top.id}" data-link>▶ Play now</a><a class="btn big ghost" href="/game/${top.id}" data-link>Details</a>` : ''}<a class="btn big ghost" href="/studio" data-link>Make your own</a></div>
  </div></div>`);
  if (top) hero.querySelector('.bg').style.backgroundImage = `url(${coverURL(top)})`;
  root.appendChild(hero);
  const wrap = el('<div class="wrap"></div>');
  wrap.appendChild(el(`<div class="pitch">
    <div><b>🎙 Monsters hear your mic</b><span>Your real voice makes noise in the game. Scream and something comes looking.</span></div>
    <div><b>🧱 Voices through walls</b><span>Proximity voice chat fades with distance and goes muffled behind walls. Walkie-talkies reach across the map.</span></div>
    <div><b>👹 Play the monster</b><span>Asymmetric modes give one player a demon voice and thermal vision.</span></div>
    <div><b>👻 Death isn't the end</b><span>Dead players become ghosts who flicker lights and whisper to the living.</span></div>
  </div>`));
  const playing = popular.games.filter((g) => g.playing > 0);
  if (playing.length) wrap.appendChild(row('Playing now', 'jump into a live room', playing));
  wrap.appendChild(row('Popular', 'most played and liked', popular.games));
  wrap.appendChild(row('New', 'fresh from creators', fresh.games.slice(0, 12)));
  wrap.appendChild(el(`<section class="row"><div class="empty" style="text-align:left;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap">
    <div><h2 style="margin:0 0 6px;font-family:var(--type);font-weight:normal">Build your own nightmare</h2><span>Write JavaScript in the browser, test it instantly, publish with one click. Multiplayer, voice and monsters come built in.</span></div>
    <div style="display:flex;gap:10px"><a class="btn red big" href="/studio" data-link>Open the Studio</a><a class="btn big ghost" href="/docs" data-link>Read the docs</a></div></div></section>`));
  root.appendChild(wrap);
  root.appendChild(el('<footer class="foot">Shiver · made by Virat Reddy Kaukuntla · every sound is synthesized, every monster is code</footer>'));
}

export async function searchPage(root, params) {
  const q = params.get('q') || '';
  const r = await api('/games?q=' + encodeURIComponent(q));
  const wrap = el('<div class="wrap"></div>');
  wrap.appendChild(row(`Results for “${q}”`, `${r.games.length} games`, r.games));
  root.appendChild(wrap);
  document.querySelector('#search input').value = q;
}
